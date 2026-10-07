import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { decidePermission } from './permission'
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
