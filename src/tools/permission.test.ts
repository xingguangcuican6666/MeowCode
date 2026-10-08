import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { decidePermission, isPlanReadOnlyCommand } from './permission'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

describe('permission.ts', () => {
  let tempDir: string
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-test-'))
    process.chdir(tempDir)
    
    // Create structure
    fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true })
    fs.mkdirSync(path.join(tempDir, '.meowcode'), { recursive: true })
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true })
  })

  afterAll(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('acceptEdits mode path protection', () => {
    it('allows edits to files in workspace', () => {
      const result = decidePermission('acceptEdits', 'write_file', {
        input: { file_path: path.join(tempDir, 'src/foo.ts') }
      })
      expect(result.action).toBe('allow')
    })

    it('prompts for .git/ files', () => {
      const result = decidePermission('acceptEdits', 'write_file', {
        input: { file_path: path.join(tempDir, '.git/config') }
      })
      expect(result.action).toBe('ask')
    })

    it('prompts for .meowcode/ files', () => {
      const result = decidePermission('acceptEdits', 'edit_file', {
        input: { file_path: path.join(tempDir, '.meowcode/settings.json') }
      })
      expect(result.action).toBe('ask')
    })

    it('prompts for .bashrc', () => {
      const result = decidePermission('acceptEdits', 'write_file', {
        input: { file_path: path.join(tempDir, '.bashrc') }
      })
      expect(result.action).toBe('ask')
    })

    it('prompts for absolute paths outside workspace', () => {
      const result = decidePermission('acceptEdits', 'write_file', {
        input: { file_path: '/tmp/outside.txt' }
      })
      expect(result.action).toBe('ask')
    })

    it('prompts for ~ paths', () => {
      const result = decidePermission('acceptEdits', 'edit_file', {
        input: { file_path: path.join(os.homedir(), 'test.txt') }
      })
      expect(result.action).toBe('ask')
    })
  })

  describe('sub-agent behavior', () => {
    it('sub-agents return ask for mutations (caller must handle)', () => {
      const result = decidePermission('default', 'bash', { sub: true })
      expect(result.action).toBe('ask')
    })

    it('sub-agents allow non-mutating tools', () => {
      const result = decidePermission('default', 'read_file', { sub: true })
      expect(result.action).toBe('allow')
    })

    it('sub-agents in plan mode still deny mutations', () => {
      const result = decidePermission('plan', 'write_file', { sub: true })
      expect(result.action).toBe('deny')
    })
  })
})

// Plan mode denies by TOOL name, and `bash` is the one tool whose name says
// nothing about whether it mutates. Denying every bash call made `grep -rn foo
// src/` fail with "plan mode cannot modify the workspace" — a read that the
// model then had no other way to perform. isPlanReadOnlyCommand re-admits the
// commands that only read, and fails closed on everything else.
describe('isPlanReadOnlyCommand', () => {
  const readOnly = [
    'grep -rn foo src/',
    'rg TODO',
    'cat package.json',
    'ls -la',
    'git status',
    'git log',
    'make -n build',
    'git diff HEAD',
    'git diff --stat',
    'git show HEAD',
    'npm ls',
    'pnpm why react',
    'cat a.json && grep -n x b.json',
    'FOO=1 grep -n x .',
    'env grep -rn x .',
    '/usr/bin/grep -rn x .',
    'wc -l src/app.tsx',
    'npm run build',
    'npm test',
  ]
  for (const cmd of readOnly) {
    it(`admits ${cmd}`, () => expect(isPlanReadOnlyCommand(cmd)).toBe(true))
  }

  const mutating = [
    'rm -rf build',
    'git commit -m wip',
    'git push',
    'git config user.name x',
    'git checkout main',
    'git stash',
    'npm install',
    'npm publish',
    'sed -i s/a/b/ f.txt',
    'cat f > g',
    'grep x . && rm -rf /',
    'grep $(whoami) .',
    'grep `id` .',
    'grep x .; rm -rf /',
    'grep x . | sh',
    'grep x . &',
    'curl https://example.com',
    'chmod +x f',
    './scripts/check.sh',
    'git',
    `node -e "require('fs').rmSync('.')"`,
    'grep -n x . > out.txt',
    'eval "rm -rf /"',
    'find . -name "*.ts"',
    '',
  ]
  for (const cmd of mutating) {
    it(`refuses ${JSON.stringify(cmd)}`, () => expect(isPlanReadOnlyCommand(cmd)).toBe(false))
  }
})

describe('plan mode admits read-only bash', () => {
  it('lets grep through instead of denying it as a workspace mutation', () => {
    expect(decidePermission('plan', 'bash', { input: { command: 'grep -rn foo src/' } }))
      .toEqual({ action: 'ask' })
    expect(decidePermission('plan', 'bash', { autoModeInPlan: true, input: { command: 'grep -rn foo src/' } }))
      .toEqual({ action: 'allow' })
  })

  it('still denies a mutating bash command', () => {
    const d = decidePermission('plan', 'bash', { autoModeInPlan: true, input: { command: 'rm -rf src' } })
    expect(d.action).toBe('deny')
  })

  it('still denies the file-editing tools', () => {
    expect(decidePermission('plan', 'write_file', { autoModeInPlan: true, input: { path: 'a' } }).action).toBe('deny')
    expect(decidePermission('plan', 'edit_file', { autoModeInPlan: true, input: { path: 'a' } }).action).toBe('deny')
  })
})
