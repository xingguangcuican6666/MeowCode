// The WebUI's browser credential, persisted so it does not change under the user.
//
// Why this exists: the token is minted per process, so every `meowcode webui`
// printed a different URL. The user pinned one, closed the tab, came back, and
// the link in their history no longer authenticated — which reads as "the token
// refreshed on me". Two halves fix that, and both are needed:
//
//   1. This file: the same token across restarts, so the printed URL is stable
//      and a link the user already kept still works.
//   2. A persistent cookie (see createWebUISecurity's `remember`): the token in
//      the URL is spent once, and what the browser keeps afterwards is the
//      cookie. A session cookie dies with the tab, so closing the page logged
//      the user out even when the token itself had not changed.
//
// Storage is 0600 in ~/.meowcode, alongside credentials.json and on the same
// terms: a credential that can drive this agent should never be world-readable.
// Delete the file to rotate — the next launch mints a fresh one.
//
// Deliberately NOT done: scoping the token to the port it was minted for. On
// localhost two WebUI servers sharing one credential is a convenience (the URL
// you bookmarked keeps working when the port moved), and the exposure is
// unchanged — anything that can read this file can already read the agent's
// API key from credentials.json.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const WEBUI_TOKEN_FILE = path.join(os.homedir(), '.meowcode', 'webui-token')

/**
 * The stored token, or null when there is none or the file is unusable.
 *
 * Never throws: an unreadable or corrupt file must not stop the WebUI from
 * starting, it just means a new token (which then overwrites the bad file).
 */
export function loadWebUIToken(): string | null {
  try {
    const v = fs.readFileSync(WEBUI_TOKEN_FILE, 'utf8').trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * Return the stored token, minting `fresh()` and storing it only if there is
 * none yet. An EXISTING token is never overwritten: two servers racing to start
 * must agree on the credential, and overwriting would invalidate the URL one of
 * them just printed.
 *
 * A write failure is not fatal — the caller still gets a working token, it just
 * will not be the same one next time.
 */
export function stableWebUIToken(fresh: () => string): string {
  const existing = loadWebUIToken()
  if (existing) return existing
  const token = fresh()
  try {
    fs.mkdirSync(path.dirname(WEBUI_TOKEN_FILE), { recursive: true })
    fs.writeFileSync(WEBUI_TOKEN_FILE, token + '\n', { mode: 0o600 })
    try { fs.chmodSync(WEBUI_TOKEN_FILE, 0o600) } catch { /* best-effort without chmod */ }
  } catch {
    // A read-only or full home directory costs the user a stable URL, nothing more.
  }
  return token
}