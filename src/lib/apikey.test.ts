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
import { loadConfig, saveConfig } from '../config'
import {
  CREDENTIALS_FILE,
  loadApiKey,
  saveApiKey,
  saveCredentials,
  clearCredentials,
  keySource,
  loadCredentials,
} from './credentials'

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
    // This is the whole reason /logout re-writes the key around clearCredentials()
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