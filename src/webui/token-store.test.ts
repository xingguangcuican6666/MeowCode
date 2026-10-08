import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The store reads os.homedir() at import time, so the home has to move BEFORE
// the module loads — otherwise this test would read and write the real
// ~/.meowcode/webui-token, i.e. rotate the credential the user is using.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meow-token-store-'))
process.env.HOME = TMP_HOME
process.env.USERPROFILE = TMP_HOME

const { stableWebUIToken, loadWebUIToken, WEBUI_TOKEN_FILE } = await import('./token-store')

describe('WebUI token store', () => {
  beforeEach(() => { fs.rmSync(WEBUI_TOKEN_FILE, { force: true }) })
  afterEach(() => {
    try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
  })

  it('mints once and hands back the same token afterwards', () => {
    // The user's actual complaint: the printed URL changed between launches, so
    // the link they had saved stopped authenticating.
    const first = stableWebUIToken(() => 'token-one')
    expect(first).toBe('token-one')
    expect(stableWebUIToken(() => 'token-two')).toBe('token-one')
    expect(loadWebUIToken()).toBe('token-one')
  })

  it('keeps the credential owner-only', () => {
    stableWebUIToken(() => 'a-secret')
    // A credential that can drive this agent must not be world-readable — the
    // same rule credentials.json follows.
    expect(fs.statSync(WEBUI_TOKEN_FILE).mode & 0o777).toBe(0o600)
  })

  it('writes it under ~/.meowcode, not the working directory', () => {
    stableWebUIToken(() => 'a-secret')
    expect(path.dirname(WEBUI_TOKEN_FILE)).toBe(path.join(TMP_HOME, '.meowcode'))
  })

  it('creates the config dir when it is missing', () => {
    // A first run on a machine with no ~/.meowcode yet must not silently fall
    // back to a per-process token.
    expect(fs.existsSync(path.join(TMP_HOME, '.meowcode'))).toBe(false)
    stableWebUIToken(() => 'fresh')
    expect(fs.readFileSync(WEBUI_TOKEN_FILE, 'utf8').trim()).toBe('fresh')
  })

  it('never throws when the file cannot be written', () => {
    // A read-only home costs the user a stable URL, not a WebUI that fails to
    // start — so the caller still gets a usable token.
    fs.mkdirSync(path.join(TMP_HOME, '.meowcode'), { recursive: true })
    fs.writeFileSync(WEBUI_TOKEN_FILE + '.blocker', 'x')
    fs.chmodSync(path.join(TMP_HOME, '.meowcode'), 0o500)
    try {
      const t = stableWebUIToken(() => 'still-works')
      expect(t).toBe('still-works')
    } finally {
      fs.chmodSync(path.join(TMP_HOME, '.meowcode'), 0o700)
    }
  })

  it('treats an empty file as no token at all', () => {
    // A zero-length file is what a truncated write leaves behind; serving it
    // would authenticate nobody and look like a broken server.
    fs.mkdirSync(path.dirname(WEBUI_TOKEN_FILE), { recursive: true })
    fs.writeFileSync(WEBUI_TOKEN_FILE, '   \n')
    expect(loadWebUIToken()).toBeNull()
    expect(stableWebUIToken(() => 'replacement')).toBe('replacement')
  })

  it('rotates when the user deletes the file', () => {
    expect(stableWebUIToken(() => 'first')).toBe('first')
    fs.rmSync(WEBUI_TOKEN_FILE)
    // The documented way to retire every cookie issued from the old token.
    expect(stableWebUIToken(() => 'second')).toBe('second')
  })
})