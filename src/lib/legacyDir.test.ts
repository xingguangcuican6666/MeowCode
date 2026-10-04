import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Same homedir-mock trick as entries.test.ts: legacyDir.ts computes both dirs
// from os.homedir() at import time, so mock homedir (not any config module) and
// everything lands under TMP. vi.mock factories are hoisted, hence vi.hoisted
// + require for the node builtins.
const { TMP } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-legacy-'))
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

import {
  LEGACY_CONFIG_DIR,
  CONFIG_DIR,
  legacyDirExists,
  alreadyMigrated,
  shouldOfferMigration,
  inspectLegacyDir,
  mergeLegacyDir,
  offerLegacyMigration,
  reportMergeOutcome,
} from './legacyDir'
import { setLang } from './i18n'

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

function seedLegacy(files: Record<string, string> = {}): void {
  for (const [rel, body] of Object.entries(files)) write(path.join(LEGACY_CONFIG_DIR, rel), body)
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
})

describe('detection', () => {
  it('reports no legacy dir when ~/.anycode is absent', () => {
    expect(legacyDirExists()).toBe(false)
    expect(alreadyMigrated()).toBe(false)
    expect(shouldOfferMigration()).toBe(false)
    expect(inspectLegacyDir()).toBeNull()
  })

  it('offers the migration when the legacy dir exists and the new one is empty', () => {
    seedLegacy({ 'settings.json': '{}' })
    expect(legacyDirExists()).toBe(true)
    expect(alreadyMigrated()).toBe(false)
    expect(shouldOfferMigration()).toBe(true)
    const info = inspectLegacyDir()
    expect(info?.dir).toBe(LEGACY_CONFIG_DIR)
    expect(info?.present).toEqual(['settings.json'])
  })

  it('never prompts once ~/.meowcode holds any state', () => {
    seedLegacy({ 'settings.json': '{}' })
    write(path.join(CONFIG_DIR, 'settings.json'), '{}')
    expect(alreadyMigrated()).toBe(true)
    expect(shouldOfferMigration()).toBe(false)
    expect(inspectLegacyDir()).toBeNull()
  })

  it('never prompts again once the marker is stamped', () => {
    seedLegacy({ 'settings.json': '{}' })
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    write(path.join(CONFIG_DIR, '.migrated-from-anycode'), `${LEGACY_CONFIG_DIR}\n`)
    expect(alreadyMigrated()).toBe(true)
    expect(shouldOfferMigration()).toBe(false)
  })

  it('hides tooling entries from the prompt listing', () => {
    seedLegacy({ 'settings.json': '{}', 'node_modules/pkg/x.js': 'x', '.DS_Store': 'junk' })
    expect(inspectLegacyDir()?.present).toEqual(['settings.json'])
  })
})

describe('mergeLegacyDir', () => {
  it('copies known files and content trees, and stamps the marker', () => {
    seedLegacy({
      'settings.json': '{"model":"old"}',
      'history.json': '[]',
      'credentials.json': '{"token":"t"}',
      'sessions/a.json': '{"id":"a"}',
      'sessions/nested/b.json': '{"id":"b"}',
      'skills/review/SKILL.md': '# review',
      'entries/work/entry.json': '{"name":"work"}',
    })
    const r = mergeLegacyDir()
    // 3 top-level files (settings/history/credentials) + 2 sessions + 1 skill
    // + 1 entry manifest.
    expect(r.files).toBe(7)
    expect(r.dirs).toBe(3)
    expect(r.skipped).toBe(0)
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf8')).toBe('{"model":"old"}')
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'credentials.json'), 'utf8')).toBe('{"token":"t"}')
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'sessions', 'nested', 'b.json'), 'utf8')).toBe('{"id":"b"}')
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review')
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'entries', 'work', 'entry.json'), 'utf8')).toBe('{"name":"work"}')
    expect(fs.existsSync(path.join(CONFIG_DIR, '.migrated-from-anycode'))).toBe(true)
    // The source is never touched — the old dir stays as a manual backup.
    expect(fs.existsSync(path.join(LEGACY_CONFIG_DIR, 'settings.json'))).toBe(true)
  })

  it('keeps existing new-side files and reports them as skipped', () => {
    seedLegacy({ 'settings.json': '{"model":"old"}', 'history.json': '["old"]' })
    write(path.join(CONFIG_DIR, 'settings.json'), '{"model":"new"}')
    const r = mergeLegacyDir()
    expect(r.skipped).toBe(1)
    expect(r.files).toBe(1) // only history.json landed
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf8')).toBe('{"model":"new"}')
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'history.json'), 'utf8')).toBe('["old"]')
  })

  it('is idempotent: a second merge adds nothing and never reverts', () => {
    seedLegacy({ 'sessions/a.json': '{"id":"a"}' })
    mergeLegacyDir()
    fs.writeFileSync(path.join(CONFIG_DIR, 'sessions', 'a.json'), '{"id":"edited"}')
    fs.writeFileSync(path.join(CONFIG_DIR, 'sessions', 'c.json'), '{"id":"c"}')
    const again = mergeLegacyDir()
    expect(again.files).toBe(0)
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'sessions', 'a.json'), 'utf8')).toBe('{"id":"edited"}')
    expect(fs.existsSync(path.join(CONFIG_DIR, 'sessions', 'c.json'))).toBe(true)
  })

  it('skips node_modules and dotfiles inside copied trees', () => {
    seedLegacy({
      'skills/review/SKILL.md': '# review',
      'skills/node_modules/dep/index.js': 'junk',
      'skills/.DS_Store': 'junk',
    })
    mergeLegacyDir()
    expect(fs.existsSync(path.join(CONFIG_DIR, 'skills', 'review', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(CONFIG_DIR, 'skills', 'node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(CONFIG_DIR, 'skills', '.DS_Store'))).toBe(false)
  })

  it('is a no-op when the legacy dir is gone', () => {
    expect(mergeLegacyDir()).toEqual({ files: 0, dirs: 0, skipped: 0 })
    expect(fs.existsSync(CONFIG_DIR)).toBe(false)
  })
})

describe('offerLegacyMigration', () => {
  // The dialog lives in Ink and is driven by cli.tsx; this module only takes the
  // answer, so these tests inject one. `isTTY` stands in for "can we ask at all"
  // — the non-TTY branch is the one print mode / pipes / CI take.
  function withTTY<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
    const prev = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
    return fn().finally(() => { Object.defineProperty(process.stdin, 'isTTY', { value: prev, configurable: true }) })
  }

  it('merges on "merge" and leaves the source dir intact', async () => {
    seedLegacy({ 'settings.json': '{"model":"old"}', 'sessions/a.json': '{"id":"a"}' })
    const outcome = await withTTY(true, () => offerLegacyMigration(async () => 'merge'))
    expect(outcome.offered).toBe(true)
    expect(outcome.merged).toBe(true)
    expect(outcome.result?.files).toBe(2)
    expect(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf8')).toBe('{"model":"old"}')
    expect(fs.existsSync(path.join(LEGACY_CONFIG_DIR, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(CONFIG_DIR, '.migrated-from-anycode'))).toBe(true)
  })

  it('creates nothing on "skip"', async () => {
    seedLegacy({ 'settings.json': '{"model":"old"}' })
    const outcome = await withTTY(true, () => offerLegacyMigration(async () => 'skip'))
    expect(outcome).toMatchObject({ offered: true, merged: false })
    expect(fs.existsSync(CONFIG_DIR)).toBe(false)
  })

  it('never asks when the new dir already has state', async () => {
    seedLegacy({ 'settings.json': '{}' })
    write(path.join(CONFIG_DIR, 'settings.json'), '{}')
    let asked = false
    const outcome = await withTTY(true, () => offerLegacyMigration(async () => { asked = true; return 'merge' }))
    expect(asked).toBe(false)
    expect(outcome.offered).toBe(false)
  })

  it('prints the mv hint instead of asking when stdin is not a TTY', async () => {
    seedLegacy({ 'settings.json': '{}' })
    const err: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true })
    let asked = false
    const outcome = await withTTY(false, () => offerLegacyMigration(async () => { asked = true; return 'merge' }))
    spy.mockRestore()
    expect(asked).toBe(false)
    expect(outcome).toMatchObject({ offered: false, merged: false })
    expect(err.join('')).toContain(`mv ${LEGACY_CONFIG_DIR} ${CONFIG_DIR}`)
    expect(fs.existsSync(CONFIG_DIR)).toBe(false)
  })

  it('localizes the non-TTY notice', async () => {
    seedLegacy({ 'settings.json': '{}' })
    const err: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true })
    setLang('zh')
    await withTTY(false, () => offerLegacyMigration(async () => 'skip'))
    setLang('en')
    spy.mockRestore()
    expect(err.join('')).toContain('本版本已不再读取')
  })
})

describe('reportMergeOutcome', () => {
  function capture(fn: () => void): string {
    const out: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true })
    try { fn() } finally { spy.mockRestore() }
    return out.join('')
  }

  it('reports the counts, and the kept files only when some were skipped', () => {
    expect(capture(() => reportMergeOutcome({ offered: true, merged: true, result: { files: 3, dirs: 2, skipped: 0 } })))
      .toContain('Merged 3 file(s) from 2 director(ies)')
    const kept = capture(() => reportMergeOutcome({ offered: true, merged: true, result: { files: 1, dirs: 1, skipped: 2 } }))
    expect(kept).toContain('2 existing file(s) kept')
  })

  it('says nothing when nothing was merged', () => {
    expect(capture(() => reportMergeOutcome({ offered: true, merged: false }))).toBe('')
  })
})