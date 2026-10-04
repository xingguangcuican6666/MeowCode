import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Same homedir-mock trick as entries.test.ts: entryInstall reaches CONFIG_DIR
// via lib/entries → ./configDir (computed from os.homedir() at import time),
// so mock homedir — not any config module — to keep everything inside TMP.
// vi.mock factories are hoisted, hence vi.hoisted + require for builtins.
const { TMP } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-entryinstall-'))
  return { TMP: home }
})
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const mocked = { ...actual, homedir: () => TMP } as Omit<typeof actual, 'default'> & { default?: unknown }
  // configDir.ts does `import os from 'node:os'` — under vitest's interop that
  // resolves to the namespace's `default`, so the mock must carry it too.
  mocked.default = mocked
  return mocked
})

import { ENTRIES_DIR } from './entries'
import {
  BUILTIN_ENTRY,
  entryExists,
  getDefaultEntry,
  materializeBuiltinEntry,
  setDefaultEntry,
  activateEntry,
} from './entries'
import { installEntry, removeEntry, EntryInstallError } from './entryInstall'

// Build a local-dir install source: package.json carrying the meowcode.entry
// template plus arbitrary content files beside it.
function makeSrc(name: string, template: Record<string, unknown>, files: Record<string, string> = {}): string {
  const root = path.join(TMP, `src-${name}`)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: `scope-${name}`, meowcode: { entry: template } }),
  )
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }
  return root
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  activateEntry(null)
})

afterEach(() => {
  activateEntry(null)
})

describe('installEntry (local dir)', () => {
  it('ships launcher/mcpServers relative files and content dirs', () => {
    const src = makeSrc('webui', {
      description: 'Web UI plugin entry',
      launcher: { command: 'node', args: ['launcher.js'] },
      mcpServers: { webui: { command: 'node', args: ['server.js'] } },
      content: { skills: { review: '# Review' } },
    }, { 'launcher.js': 'console.log(1)', 'server.js': 'console.log(2)' })
    const msg = installEntry(src)
    expect(msg).toMatch(/^Installed entry "scope-webui"/)
    const dir = path.join(ENTRIES_DIR, 'scope-webui')
    expect(fs.readFileSync(path.join(dir, 'launcher.js'), 'utf8')).toBe('console.log(1)')
    expect(fs.readFileSync(path.join(dir, 'server.js'), 'utf8')).toBe('console.log(2)')
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'entry.json'), 'utf8'))
    expect(manifest.launcher).toEqual({ command: 'node', args: ['launcher.js'] })
    expect(fs.readFileSync(path.join(dir, 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# Review')
  })

  it('skips absolute paths and directory-escape attempts', () => {
    const src = makeSrc('evil', {
      launcher: { command: 'node', args: ['/abs/x.js', '../evil.js', '~/y.js', 'ok.js'] },
    }, { 'ok.js': 'ok' })
    installEntry(src)
    const dir = path.join(ENTRIES_DIR, 'scope-evil')
    expect(fs.existsSync(path.join(dir, 'ok.js'))).toBe(true)
    expect(fs.existsSync(path.join(TMP, 'evil.js'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'evil.js'))).toBe(false)
  })

  it('never overwrites existing files, even with --force', () => {
    const src = makeSrc('w', { launcher: { command: 'node', args: ['launcher.js'] } }, { 'launcher.js': 'v1' })
    installEntry(src)
    const target = path.join(ENTRIES_DIR, 'scope-w', 'launcher.js')
    fs.writeFileSync(target, 'user edit')
    // Without force the reinstall is refused outright …
    expect(() => installEntry(src)).toThrow(EntryInstallError)
    // … and with force new content is added but present files survive.
    const msg = installEntry(src, { force: true })
    expect(msg).toMatch(/^Refreshed entry/)
    expect(fs.readFileSync(target, 'utf8')).toBe('user edit')
  })

  it('throws EntryInstallError when the source has no manifest', () => {
    const root = path.join(TMP, 'src-bare')
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bare' }))
    expect(() => installEntry(root)).toThrow(EntryInstallError)
  })
})

describe('removeEntry', () => {
  it('removes an empty entry and reports it', () => {
    const src = makeSrc('gone', { description: 'temp' })
    installEntry(src)
    expect(entryExists('scope-gone')).toBe(true)
    const msg = removeEntry('scope-gone')
    expect(msg).toMatch(/Removed entry "scope-gone"/)
    expect(entryExists('scope-gone')).toBe(false)
  })

  it('refuses entries holding sessions/memory data without --force', () => {
    const src = makeSrc('lived', { description: 'temp' })
    installEntry(src)
    fs.mkdirSync(path.join(ENTRIES_DIR, 'scope-lived', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(ENTRIES_DIR, 'scope-lived', 'sessions', 's.json'), '{}')
    expect(() => removeEntry('scope-lived')).toThrow(EntryInstallError)
    expect(entryExists('scope-lived')).toBe(true)
    removeEntry('scope-lived', { force: true })
    expect(entryExists('scope-lived')).toBe(false)
  })

  it('clears the default-entry pointer when removing the default', () => {
    const src = makeSrc('def', { description: 'temp' })
    installEntry(src)
    setDefaultEntry('scope-def')
    removeEntry('scope-def', { force: true })
    expect(getDefaultEntry()).toBeNull()
  })

  // The built-in entry is materialized on every startup, so removing it would
  // only make it reappear — and it is the one entry the user must not be able
  // to delete by accident (or with --force).
  it('refuses to remove the built-in tui entry, even with --force', () => {
    materializeBuiltinEntry()
    expect(() => removeEntry(BUILTIN_ENTRY, { force: true })).toThrow(EntryInstallError)
    expect(entryExists(BUILTIN_ENTRY)).toBe(true)
  })

  it('removing the default built-in entry clears nothing — it refuses first', () => {
    materializeBuiltinEntry()
    setDefaultEntry(BUILTIN_ENTRY)
    expect(() => removeEntry(BUILTIN_ENTRY)).toThrow(EntryInstallError)
    expect(getDefaultEntry()).toBe(BUILTIN_ENTRY)
  })
})
