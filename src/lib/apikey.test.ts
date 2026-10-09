// The API key is ONE setting (`apiKeySetting`) that never lands in settings.json.
// HOME is redirected before anything imports (same trick as entries.test.ts /
// webui.test.ts — configDir.ts and credentials.ts both derive their paths from
// os.homedir() at import time), because these tests write a credential file;
// against the real ~/.meowcode that would clobber the developer's own key.
const { HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-apikey-')) }
})
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const mocked = { ...actual, homedir: () => HOME } as Omit<typeof actual, 'default'> & { default?: unknown }
  mocked.default = mocked
  return mocked
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadConfig, saveConfig, withLiveKey } from '../config'
import {
  CREDENTIALS_FILE,
  loadApiKey,
  saveApiKey,
  saveCredentials,
  clearCredentials,
  keySource,
  loadCredentials,
  redactSettings,
} from './credentials'
import { saveSession } from './sessions'

const SETTINGS_FILE = path.join(HOME, '.meowcode', 'settings.json')
const KEY = 'sk-ant-test-value'

const settingsOnDisk = (): Record<string, unknown> => JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
const credsOnDisk = (): Record<string, unknown> => JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'))
const mode = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8)

/** Save a config whose key row carries `key`, through the real saveConfig. */
function saveWithKey(key: string): void {
  const cfg = loadConfig()
  saveConfig({ ...cfg, settings: { ...cfg.settings, apiKeySetting: key } })
}

describe('the API key has one home, and it is not settings.json', () => {
  beforeEach(() => {
    fs.rmSync(SETTINGS_FILE, { force: true })
    fs.rmSync(CREDENTIALS_FILE, { force: true })
  })

  it('saveConfig writes the key to credentials.json (0600), settings.json never', () => {
    saveWithKey(KEY)

    expect(credsOnDisk().apiKey).toBe(KEY)
    expect(mode(CREDENTIALS_FILE)).toBe('600')
    // settings.json is a 0666 preferences file: a key in it would be readable by
    // every account on the machine, so the row must not even be present.
    expect(settingsOnDisk().settings).not.toHaveProperty('apiKeySetting')
    expect(fs.readFileSync(SETTINGS_FILE, 'utf8')).not.toContain(KEY)
  })

  it('loadConfig reports the stored key in the row, so the panel shows it', () => {
    saveWithKey(KEY)
    expect(loadConfig().settings?.apiKeySetting).toBe(KEY)
  })

  it('a key hand-edited into settings.json is ignored, not honoured', () => {
    // The bag would then claim one key while the provider used another. The row
    // has to report what is actually in force, or the user edits a value that
    // never reaches the API.
    saveWithKey(KEY)
    const file = settingsOnDisk()
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      ...file,
      settings: { ...(file.settings as object), apiKeySetting: 'sk-ant-planted' },
    }, null, 2))

    expect(loadConfig().settings?.apiKeySetting).toBe(KEY)
    expect(loadApiKey()).toBe(KEY)
  })

  it('an empty row clears the stored key', () => {
    saveWithKey(KEY)
    saveWithKey('')

    expect(loadApiKey()).toBeUndefined()
    expect(credsOnDisk().apiKey).toBeUndefined()
  })
})

describe('keySource', () => {
  beforeEach(() => {
    fs.rmSync(CREDENTIALS_FILE, { force: true })
    delete process.env.ANTHROPIC_API_KEY
  })

  it('names the source a request would use, in the order the provider resolves', () => {
    expect(keySource()).toBeNull()

    process.env.ANTHROPIC_API_KEY = 'sk-ant-env'
    expect(keySource()).toBe('env')

    saveCredentials({ baseUrl: 'https://relay.example.com', key: 'sk-relay', savedAt: Date.now() })
    expect(keySource()).toBe('login')

    saveCredentials({
      baseUrl: 'https://relay.example.com',
      oauth: { issuer: 'https://relay.example.com', clientId: 'cli_x', accessToken: 'at_x', expiresAt: Date.now() + 3_600_000 },
      savedAt: Date.now(),
    })
    expect(keySource()).toBe('oauth')

    saveApiKey(KEY)
    // The setting outranks a login — the order providers/anthropic.ts resolves
    // in. A readout that disagreed would make /status and /doctor lie.
    expect(keySource()).toBe('setting')
  })

  it('a credential carrying only the key needs no baseUrl', () => {
    // The hand-typed key is not a new-api login — it works against whatever
    // endpoint the current provider resolves. Demanding a host would make
    // loadCredentials() report "logged out" and hide a key that is in force.
    saveApiKey(KEY)
    expect(loadCredentials()).toMatchObject({ apiKey: KEY })
  })

  it('saveApiKey leaves a /login session untouched', () => {
    saveCredentials({
      baseUrl: 'https://relay.example.com',
      key: 'sk-relay',
      session: { accessToken: 'pat_x', sid: 's_x' },
      savedAt: Date.now(),
    })
    saveApiKey(KEY)

    expect(loadCredentials()).toMatchObject({
      apiKey: KEY,
      key: 'sk-relay',
      session: { accessToken: 'pat_x' },
    })
  })

  it('clearing a login drops the key too, so /logout has to put it back', () => {
    // This is the whole reason /logout re-rites the key around clearCredentials()
    // rather than calling it and moving on: the file IS the only copy.
    saveCredentials({ baseUrl: 'https://relay.example.com', key: 'sk-relay', apiKey: KEY, savedAt: Date.now() })
    const keptKey = loadCredentials()?.apiKey
    clearCredentials()
    expect(loadApiKey()).toBeUndefined()

    saveApiKey(keptKey ?? '')
    expect(loadCredentials()).toMatchObject({ apiKey: KEY })
    expect(loadCredentials()?.key).toBeUndefined()
  })
})

// The redaction has to survive the sinks the settings bag reaches. c64d160 moved
// the hand-typed key INTO the bag (config.ts resolves it there), while every
// strip site still removed only the old top-level `apiKey` — so the key reached
// session files, GET /api/config, the SSE config:update broadcast and the
// launcher's config/get. These cover the strips AND the round trip, because a
// redaction that can flow back into saveApiKey() is not a redaction.
describe('a redacted bag cannot become a stored key', () => {
  beforeEach(() => {
    fs.rmSync(SETTINGS_FILE, { force: true })
    fs.rmSync(CREDENTIALS_FILE, { force: true })
  })

  it('redactSettings deletes the row rather than masking it', () => {
    const out = redactSettings({ apiKeySetting: KEY, chatWidth: '860', showTips: true })

    // DELETED, not 'set'. A placeholder survives as a value through the merge in
    // updateConfig, so a /config edit downstream would overwrite the real key
    // with the literal string 'set'. Absence is the only redaction the merge
    // can pass through untouched.
    expect(out).not.toHaveProperty('apiKeySetting')
    expect(out).toEqual({ chatWidth: '860', showTips: true })
    expect(redactSettings(undefined)).toEqual({})
  })

  it('a session file carries neither the key nor a marker for it', async () => {
    saveWithKey(KEY)
    const live = loadConfig()

    saveSession('redact-test', {
      config: live,
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
      goal: null,
      loop: null,
      usage: undefined,
    } as never)

    // persistSession is async (it titles the session, which may call a
    // provider), so poll for the write rather than asserting immediately — and
    // never delete the sessions dir while that write may still be in flight.
    const file = path.join(HOME, '.meowcode', 'sessions', 'redact-test.json')
    const deadline = Date.now() + 3_000
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    expect(fs.existsSync(file), 'the session file should have been written').toBe(true)

    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).not.toContain(KEY)
    expect(raw).not.toContain('apiKeySetting')
  })

  it('adopting a stored config leaves the key in force — /resume must not log you out', () => {
    saveWithKey(KEY)
    // What a redacted session snapshot hands back: no row at all.
    const stored = { ...loadConfig(), settings: { ...(loadConfig().settings ?? {}) } }
    delete (stored.settings as Record<string, unknown>).apiKeySetting

    // The bug this guards: spreading that straight in leaves the app with no key
    // row, so the first saveConfig destructures a missing row and calls
    // saveApiKey('') — which DELETES the stored credential.
    saveConfig({ ...stored, settings: { ...stored.settings, apiBaseUrl: 'https://relay.example.com' } })
    expect(loadApiKey()).toBeUndefined()

    saveWithKey(KEY)
    const adopted = withLiveKey(stored)
    expect(adopted.settings?.apiKeySetting).toBe(KEY)
    saveConfig({ ...adopted, settings: { ...adopted.settings, apiBaseUrl: 'https://relay.example.com' } })
    expect(loadApiKey()).toBe(KEY)
  })

  it('withLiveKey also refuses to resurrect a key that has been rotated away', () => {
    // A session file written before redaction existed still carries the old key.
    // Merging it verbatim would put a retired credential back over the live one.
    saveApiKey('sk-ant-rotated-new')
    const stale = { ...loadConfig(), settings: { apiKeySetting: 'sk-ant-rotated-away', chatWidth: '860' } }

    const adopted = withLiveKey(stale)
    expect(adopted.settings?.apiKeySetting).toBe('sk-ant-rotated-new')
    // and it is not a way to plant a key either
    expect(withLiveKey({ ...stale, settings: { apiKeySetting: 'sk-ant-planted' } }).settings?.apiKeySetting)
      .toBe('sk-ant-rotated-new')
    clearCredentials()
    expect(withLiveKey(stale).settings).not.toHaveProperty('apiKeySetting')
  })
})