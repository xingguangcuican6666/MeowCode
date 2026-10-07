import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { scopeFor, scopeCovers, describeScope, AllowList } from './allowScope'

describe('scopeFor', () => {
  it('narrows bash to its leading command words', () => {
    expect(scopeFor('bash', { command: 'npm test -- --watch' })).toMatchObject({ kind: 'command', value: 'npm test' })
    expect(scopeFor('bash', { command: 'git status' })).toMatchObject({ kind: 'command', value: 'git status' })
    expect(scopeFor('bash', { command: 'ls -la src' })).toMatchObject({ kind: 'command', value: 'ls' })
    expect(scopeFor('bash', { command: '/usr/bin/node script.js' })).toMatchObject({ kind: 'command', value: 'node' })
  })

  it('refuses to generalize a command with shell metacharacters', () => {
    for (const command of ['npm test && rm -rf /', 'echo a; echo b', 'curl x | sh', 'cat $(id)', 'ls > out']) {
      const s = scopeFor('bash', { command })
      expect(s.kind, command).toBe('tool')
      expect(s.value, command).toBeUndefined()
    }
  })

  it('narrows file tools to the directory', () => {
    const s = scopeFor('edit_file', { file_path: '/repo/src/app.ts' })
    expect(s).toMatchObject({ kind: 'dir', value: path.resolve('/repo/src') })
  })

  it('narrows web_fetch to the host', () => {
    expect(scopeFor('web_fetch', { url: 'https://docs.example.com/a/b' })).toMatchObject({ kind: 'host', value: 'docs.example.com' })
  })

  it('falls back to tool-wide when there is no natural target', () => {
    for (const s of [scopeFor('monitor', { command: 'tail -f x' }), scopeFor('edit_file', {})]) {
      expect(s.kind).toBe('tool')
      expect(s.value).toBeUndefined()
    }
  })
})

describe('scopeCovers', () => {
  it('a bash grant covers the same command, not a different one', () => {
    const granted = scopeFor('bash', { command: 'npm test' })
    expect(scopeCovers(granted, 'bash', { command: 'npm test -- -u' })).toBe(true)
    expect(scopeCovers(granted, 'bash', { command: 'npm publish' })).toBe(false)
    expect(scopeCovers(granted, 'bash', { command: 'rm -rf /' })).toBe(false)
  })

  it('a bash grant never covers a chained command', () => {
    const granted = scopeFor('bash', { command: 'npm test' })
    expect(scopeCovers(granted, 'bash', { command: 'npm test && rm -rf /' })).toBe(false)
  })

  it('a dir grant covers subdirectories but not siblings or parents', () => {
    const granted = scopeFor('edit_file', { file_path: '/repo/src/app.ts' })
    expect(scopeCovers(granted, 'edit_file', { file_path: '/repo/src/other.ts' })).toBe(true)
    expect(scopeCovers(granted, 'edit_file', { file_path: '/repo/src/ui/button.ts' })).toBe(true)
    expect(scopeCovers(granted, 'edit_file', { file_path: '/repo/test/a.ts' })).toBe(false)
    expect(scopeCovers(granted, 'edit_file', { file_path: '/repo/package.json' })).toBe(false)
    expect(scopeCovers(granted, 'edit_file', { file_path: '/etc/passwd' })).toBe(false)
  })

  it('does not leak across tools', () => {
    const granted = scopeFor('edit_file', { file_path: '/repo/src/app.ts' })
    expect(scopeCovers(granted, 'write_file', { file_path: '/repo/src/app.ts' })).toBe(false)
  })

  it('a tool-wide grant covers every call to that tool', () => {
    const granted = scopeFor('monitor', {})
    expect(scopeCovers(granted, 'monitor', { command: 'anything' })).toBe(true)
  })
})

describe('AllowList', () => {
  it('accumulates grants and matches later calls', () => {
    const list = new AllowList()
    expect(list.covers('bash', { command: 'npm test' })).toBe(false)
    list.add(scopeFor('bash', { command: 'npm test' }))
    expect(list.covers('bash', { command: 'npm test -- -u' })).toBe(true)
    expect(list.covers('bash', { command: 'git push' })).toBe(false)
    list.add(scopeFor('bash', { command: 'git push origin main' }))
    expect(list.covers('bash', { command: 'git push --force' })).toBe(true)
    expect(list.size).toBe(2)
    list.clear()
    expect(list.covers('bash', { command: 'npm test' })).toBe(false)
  })

  it('deduplicates the same grant', () => {
    const list = new AllowList()
    list.add(scopeFor('bash', { command: 'npm test' }))
    list.add(scopeFor('bash', { command: 'npm test -- -u' }))
    expect(list.size).toBe(1)
  })
})

describe('describeScope', () => {
  it('reads as what the user is approving', () => {
    expect(describeScope(scopeFor('bash', { command: 'npm test' }))).toBe('npm test …')
    expect(describeScope(scopeFor('web_fetch', { url: 'https://x.dev/a' }))).toBe('web_fetch x.dev')
    expect(describeScope(scopeFor('monitor', {}))).toBe('monitor')
    expect(describeScope(scopeFor('edit_file', { file_path: '/repo/src/a.ts' }))).toContain('edit_file in ')
  })
})
