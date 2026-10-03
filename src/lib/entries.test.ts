import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '../types'

// Point CONFIG_DIR at a fresh temp dir per test file; saveConfig becomes a spy
// so entryAwareSaveConfig's global path can be asserted without touching disk.
// vi.hoisted + require: vi.mock factories run before the module's own imports
// are initialized, so node builtins must be pulled in here (not at top level).
const { TMP, saveConfigSpy } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  /* eslint-enable @typescript-eslint/no-require-imports */
  // The mocked os.homedir() must be callable when vi.mock('node:os') reads it,
  // so the fake home is built here and referenced from both factories.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-entries-'))
  return {
    TMP: home,
    CONFIG_DIR: path.join(home, '.anycode'),
    saveConfigSpy: vi.fn(),
  }
})
// entries.ts takes CONFIG_DIR from ./configDir, which computes it from
// os.homedir() at import time — mocking ../config's CONFIG_DIR would never
// reach it (and the tests would read the real ~/.anycode). Mock homedir
// instead so every derived path lands inside TMP.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const mocked = { ...actual, homedir: () => TMP } as Omit<typeof actual, 'default'> & { default?: unknown }
  // configDir.ts does `import os from 'node:os'` — under vitest's interop that
  // resolves to the namespace's `default`, so the mock must carry it too.
  mocked.default = mocked
  return mocked
})
// saveConfig is spied (and kept off the real disk); entries.ts imports it from
// ../config, so the mock must cover that specifier.
vi.mock('../config', () => ({ saveConfig: saveConfigSpy }))

import {
  ENTRIES_DIR,
  CONFIG_DIR,
  isValidEntryName,
  isLauncherDecl,
  entryDir,
  readEntryOverrides,
  listEntries,
  entryExists,
  getDefaultEntry,
  setDefaultEntry,
  activateEntry,
  activeEntry,
  activeEntryName,
  entryActive,
  stateDir,
  stateFile,
  applyEntryOverrides,
  entryAwareSaveConfig,
  createEntry,
} from './entries'

function baseConfig(): AppConfig {
  return {
    provider: 'mock',
    model: 'claude-opus-4-8',
    theme: 'dark',
    apiKey: 'env-key',
    settings: { autoCompact: true, effort: 'medium' },
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  saveConfigSpy.mockClear()
  activateEntry(null)
})

afterEach(() => {
  activateEntry(null)
})

describe('isValidEntryName / entryDir', () => {
  it('rejects empty, dot and tooling-reserved names', () => {
    expect(isValidEntryName('')).toBe(false)
    expect(isValidEntryName('.')).toBe(false)
    expect(isValidEntryName('..')).toBe(false)
    expect(isValidEntryName('node_modules')).toBe(false)
  })

  it('rejects path separators and overlong names', () => {
    expect(isValidEntryName('a/b')).toBe(false)
    expect(isValidEntryName('a\\b')).toBe(false)
    expect(isValidEntryName('x'.repeat(65))).toBe(false)
  })

  it('accepts ordinary names', () => {
    expect(isValidEntryName('work')).toBe(true)
    expect(isValidEntryName('my-entry_2')).toBe(true)
    expect(isValidEntryName('x'.repeat(64))).toBe(true)
  })

  it('entryDir throws on invalid names and resolves valid ones', () => {
    expect(() => entryDir('../escape')).toThrow()
    expect(entryDir('work')).toBe(path.join(ENTRIES_DIR, 'work'))
  })
})

describe('isLauncherDecl', () => {
  it('accepts objects with a non-empty command', () => {
    expect(isLauncherDecl({ command: 'node', args: ['launcher.js'] })).toBe(true)
  })

  it('rejects missing/empty/non-string commands', () => {
    expect(isLauncherDecl(undefined)).toBe(false)
    expect(isLauncherDecl(null)).toBe(false)
    expect(isLauncherDecl({})).toBe(false)
    expect(isLauncherDecl({ command: '' })).toBe(false)
    expect(isLauncherDecl({ command: 42 })).toBe(false)
  })
})

describe('listEntries / readEntryOverrides', () => {
  it('returns [] when ENTRIES_DIR is missing', () => {
    expect(listEntries()).toEqual([])
  })

  it('lists valid subdirectories sorted by name, with descriptions', () => {
    writeJson(path.join(ENTRIES_DIR, 'beta', 'entry.json'), { description: 'second' })
    writeJson(path.join(ENTRIES_DIR, 'alpha', 'entry.json'), { description: 'first' })
    fs.mkdirSync(path.join(ENTRIES_DIR, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(ENTRIES_DIR, 'a-file'), 'x')
    const names = listEntries().map((e) => e.name)
    expect(names).toEqual(['alpha', 'beta'])
    expect(listEntries()[0]).toMatchObject({ name: 'alpha', description: 'first', hasLauncher: false })
  })

  it('marks entries whose entry.json declares a launcher', () => {
    writeJson(path.join(ENTRIES_DIR, 'webui', 'entry.json'), { launcher: { command: 'node', args: ['launcher.js'] } })
    writeJson(path.join(ENTRIES_DIR, 'plain', 'entry.json'), { description: 'no launcher' })
    const byName = Object.fromEntries(listEntries().map((e) => [e.name, e]))
    expect(byName.webui.hasLauncher).toBe(true)
    expect(byName.plain.hasLauncher).toBe(false)
  })

  it('tolerates missing/corrupt entry.json', () => {
    fs.mkdirSync(path.join(ENTRIES_DIR, 'bare'), { recursive: true })
    expect(readEntryOverrides('bare')).toEqual({})
    fs.writeFileSync(path.join(ENTRIES_DIR, 'bare', 'entry.json'), '{nope')
    expect(readEntryOverrides('bare')).toEqual({})
  })

  it('strips a self-referential name field', () => {
    writeJson(path.join(ENTRIES_DIR, 'e', 'entry.json'), { name: 'e', model: 'x' })
    const ov = readEntryOverrides('e')
    expect(ov).not.toHaveProperty('name')
    expect(ov.model).toBe('x')
  })

  it('entryExists reflects the directory', () => {
    expect(entryExists('e')).toBe(false)
    fs.mkdirSync(path.join(ENTRIES_DIR, 'e'), { recursive: true })
    expect(entryExists('e')).toBe(true)
    expect(entryExists('a/b')).toBe(false)
  })
})

describe('default entry persistence', () => {
  it('round-trips set/get and clears on null', () => {
    expect(getDefaultEntry()).toBeNull()
    setDefaultEntry('work')
    expect(getDefaultEntry()).toBe('work')
    const raw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'entry.json'), 'utf8'))
    expect(raw).toEqual({ default: 'work' })
    setDefaultEntry(null)
    expect(getDefaultEntry()).toBeNull()
    expect(fs.existsSync(path.join(CONFIG_DIR, 'entry.json'))).toBe(false)
  })

  it('returns null on corrupt content', () => {
    writeJson(path.join(CONFIG_DIR, 'entry.json'), '{broken')
    expect(getDefaultEntry()).toBeNull()
    writeJson(path.join(CONFIG_DIR, 'entry.json'), { default: '../bad' })
    expect(getDefaultEntry()).toBeNull()
  })

  it('rejects invalid names on set', () => {
    expect(() => setDefaultEntry('a/b')).toThrow()
  })
})

describe('active-entry context and path routing', () => {
  it('routes to global paths with no entry active', () => {
    expect(entryActive()).toBe(false)
    expect(activeEntry()).toBeNull()
    expect(activeEntryName()).toBeNull()
    expect(stateDir('sessions')).toBe(path.join(CONFIG_DIR, 'sessions'))
    expect(stateDir('memory')).toBe(path.join(CONFIG_DIR, 'memory'))
    expect(stateDir('projects')).toBe(path.join(CONFIG_DIR, 'projects'))
    expect(stateDir('mailbox')).toBe(path.join(CONFIG_DIR, 'mailbox'))
    expect(stateFile('history')).toBe(path.join(CONFIG_DIR, 'history.json'))
  })

  it('routes to per-entry paths when active and mkdirs the entry dir', () => {
    const a = activateEntry('work')
    expect(a).toEqual({ name: 'work', dir: path.join(ENTRIES_DIR, 'work') })
    expect(entryActive()).toBe(true)
    expect(activeEntryName()).toBe('work')
    expect(fs.statSync(path.join(ENTRIES_DIR, 'work')).isDirectory()).toBe(true)
    expect(stateDir('sessions')).toBe(path.join(ENTRIES_DIR, 'work', 'sessions'))
    expect(stateFile('history')).toBe(path.join(ENTRIES_DIR, 'work', 'history.json'))
  })

  it('activateEntry(null) restores global mode', () => {
    activateEntry('work')
    expect(activateEntry(null)).toBeNull()
    expect(entryActive()).toBe(false)
    expect(stateDir('sessions')).toBe(path.join(CONFIG_DIR, 'sessions'))
  })

  it('throws on an invalid entry name', () => {
    expect(() => activateEntry('..')).toThrow()
    expect(entryActive()).toBe(false)
  })
})

describe('applyEntryOverrides', () => {
  it('returns base unchanged with no active entry', () => {
    const base = baseConfig()
    expect(applyEntryOverrides(base)).toBe(base)
  })

  it('overlays the entry settings.json, merging the settings bag key-by-key', () => {
    activateEntry('work')
    writeJson(path.join(ENTRIES_DIR, 'work', 'settings.json'), {
      model: 'entry-model',
      settings: { effort: 'high' },
    })
    const cfg = applyEntryOverrides(baseConfig())
    expect(cfg.model).toBe('entry-model')
    expect(cfg.provider).toBe('mock') // untouched by the layer
    expect(cfg.settings).toEqual({ autoCompact: true, effort: 'high' })
  })

  it('entry.json beats entry settings.json and base', () => {
    activateEntry('work')
    writeJson(path.join(ENTRIES_DIR, 'work', 'settings.json'), {
      model: 'entry-model',
      settings: { effort: 'high' },
    })
    writeJson(path.join(ENTRIES_DIR, 'work', 'entry.json'), {
      model: 'override-model',
      theme: 'light',
      settings: { effort: 'max' },
    })
    const cfg = applyEntryOverrides(baseConfig())
    expect(cfg.model).toBe('override-model')
    expect(cfg.theme).toBe('light')
    expect(cfg.settings).toEqual({ autoCompact: true, effort: 'max' })
  })

  it('never takes apiKey from entry files', () => {
    activateEntry('work')
    writeJson(path.join(ENTRIES_DIR, 'work', 'settings.json'), { apiKey: 'from-file' })
    const cfg = applyEntryOverrides(baseConfig())
    expect(cfg.apiKey).toBe('env-key')
  })

  it('replaces bag-shaped keys only when entry.json carries them', () => {
    activateEntry('work')
    const perms = { allow: ['bash'] }
    writeJson(path.join(ENTRIES_DIR, 'work', 'entry.json'), { permissions: perms })
    const cfg = applyEntryOverrides(baseConfig())
    expect(cfg.permissions).toEqual(perms)
    expect(cfg.hooks).toBeUndefined()
  })

  it('tolerates a corrupt entry settings.json', () => {
    activateEntry('work')
    fs.writeFileSync(path.join(ENTRIES_DIR, 'work', 'settings.json'), '{oops')
    const base = baseConfig()
    const cfg = applyEntryOverrides(base)
    expect(cfg.model).toBe(base.model)
    expect(cfg.settings).toEqual(base.settings)
  })

  it('anchors relative mcpServers args against the entry dir', () => {
    activateEntry('work')
    writeJson(path.join(ENTRIES_DIR, 'work', 'entry.json'), {
      mcpServers: {
        webui: { command: 'node', args: ['server.js', '--port', '8080', '/abs/x.js', '~/y.js'] },
      },
    })
    const cfg = applyEntryOverrides(baseConfig())
    const dir = path.join(ENTRIES_DIR, 'work')
    expect(cfg.mcpServers?.webui.args).toEqual([
      path.join(dir, 'server.js'), '--port', '8080', '/abs/x.js', '~/y.js',
    ])
  })
})

describe('entryAwareSaveConfig', () => {
  it('delegates to the global saveConfig with no active entry', () => {
    entryAwareSaveConfig(baseConfig())
    expect(saveConfigSpy).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(ENTRIES_DIR, 'work', 'settings.json'))).toBe(false)
  })

  it('writes the apiKey-stripped config to the entry settings.json when active', () => {
    activateEntry('work')
    entryAwareSaveConfig(baseConfig())
    expect(saveConfigSpy).not.toHaveBeenCalled()
    const saved = JSON.parse(fs.readFileSync(path.join(ENTRIES_DIR, 'work', 'settings.json'), 'utf8'))
    expect(saved).not.toHaveProperty('apiKey')
    expect(saved.model).toBe('claude-opus-4-8')
  })
})

describe('createEntry', () => {
  it('writes entry.json from the template and normalizes content keys', () => {
    createEntry('work', {
      description: 'Work profile',
      model: 'claude-opus-4-8',
      settings: { effort: 'high' },
      launcher: { command: 'node', args: ['launcher.js'] },
      content: {
        skills: { review: '# Review skill', 'tidy.md': '# Tidy', 'deep.SKILL.md': '# Deep' },
        commands: { 'standup.md': 'standup body' },
        agents: { explorer: 'agent body' },
      },
    })
    const dir = path.join(ENTRIES_DIR, 'work')
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'entry.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: 'work', description: 'Work profile', model: 'claude-opus-4-8', settings: { effort: 'high' }, launcher: { command: 'node', args: ['launcher.js'] } })
    expect(fs.readFileSync(path.join(dir, 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# Review skill')
    expect(fs.readFileSync(path.join(dir, 'skills', 'tidy', 'SKILL.md'), 'utf8')).toBe('# Tidy')
    expect(fs.readFileSync(path.join(dir, 'skills', 'deep', 'SKILL.md'), 'utf8')).toBe('# Deep')
    expect(fs.readFileSync(path.join(dir, 'commands', 'standup.md'), 'utf8')).toBe('standup body')
    expect(fs.readFileSync(path.join(dir, 'agents', 'explorer.md'), 'utf8')).toBe('agent body')
  })

  it('omits content dirs and absent manifest keys without a template', () => {
    createEntry('plain')
    const dir = path.join(ENTRIES_DIR, 'plain')
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'entry.json'), 'utf8'))
    expect(manifest).toEqual({ name: 'plain' })
    expect(fs.existsSync(path.join(dir, 'skills'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'commands'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'agents'))).toBe(false)
  })

  it('never overwrites existing files', () => {
    createEntry('work', { description: 'first' })
    createEntry('work', { description: 'second' })
    const manifest = JSON.parse(fs.readFileSync(path.join(ENTRIES_DIR, 'work', 'entry.json'), 'utf8'))
    expect(manifest.description).toBe('first')
  })

  it('throws on an invalid name', () => {
    expect(() => createEntry('a/b')).toThrow()
  })
})
