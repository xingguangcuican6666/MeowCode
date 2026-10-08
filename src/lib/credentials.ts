// Persistent login credentials for the `newapi` provider (see /login, /logout).
//
// This is DELIBERATELY separate from settings.json (see src/config.ts, which
// strips `apiKey` before every write). settings.json must never hold a key; a
// login credential is different — it is written only by an explicit /login, to
// its own file, with 0600 permissions. That keeps the "never silently persist
// the env-sourced key" rule intact while still letting /login survive a restart
// (and /logout revoke it). The relay key here authorizes model calls through
// new-api's Anthropic-compatible `/v1/messages` endpoint.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export const CREDENTIALS_FILE = path.join(os.homedir(), '.meowcode', 'credentials.json')

// The panel login session — present only for password logins, so /logout can
// revoke it server-side (POST /api/user/auth/logout). Absent for a pasted key.
export interface PanelSession {
  accessToken: string   // panel JWT/PAT (Authorization: Bearer for /api/*)
  sid?: string          // login session id (sent as X-Auth-Session on logout)
  cookie?: string       // raw Cookie header to replay (holds the refresh token)
  username?: string
  expiresAt?: number    // access_expires_at (epoch seconds), informational
}

// The OAuth session — present only for browser (OAuth2/PKCE) logins. Unlike a
// panel/pasted login, an OAuth login has NO separate sk- relay key: the at_ access
// token below is itself the bearer for /v1/messages (scope models.invoke). It
// expires (~1h) and is rotated via the rt_ refresh token, so refreshToken is now
// load-bearing (see lib/oauth resolveRelayToken/refreshRelayToken), not just kept
// for /logout's POST /oauth2/revoke.
export interface OAuthSession {
  issuer: string        // authorization server base (new-api host)
  clientId: string      // the registered public client id (cli_…)
  accessToken: string   // at_… — the Bearer for /v1/messages and /oauth2/userinfo
  refreshToken?: string // rt_… (rotates on every refresh; replay revokes the family)
  idToken?: string      // RS256 JWT (only when openid scope granted)
  scope?: string        // granted scopes, space-separated
  expiresAt?: number    // access token expiry (epoch ms); drives proactive refresh
}

export interface Credentials {
  baseUrl: string       // new-api host base, e.g. https://newapi.example.com
  // Relay key (sk-…) for /v1/messages, from a pasted key or a password login.
  // ABSENT for an OAuth login — that uses oauth.accessToken (at_…) as the bearer.
  key?: string
  // The `apiKeySetting` row's key — the ONE home for the hand-typed key. Stored
  // here rather than in settings.json (see src/config.ts): settings.json is a
  // 0666 preferences file, so a key in it would be readable by every account on
  // the machine. Distinct from `key` above, which belongs to a new-api LOGIN:
  // the setting is not a login and carries no host, oauth session or /logout
  // revocation.
  apiKey?: string
  session?: PanelSession
  oauth?: OAuthSession
  savedAt: number       // epoch ms
}

// Read the credential file RAW, with no "is this a usable login" judgment.
// loadCredentials() answers a different question (see below), so the key needs
// its own accessor: a hand-typed key with no host is a working credential, not a
// "logged out" relay.
function readFile(): Partial<Credentials> | null {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')) as Partial<Credentials>
  } catch {
    // no credentials yet, or unreadable — treat as no credential at all
    return null
  }
}

function write(c: Partial<Credentials>): void {
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true })
  // 0600: owner read/write only — a key on disk should never be world-readable.
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(c, null, 2), { mode: 0o600 })
  try { fs.chmodSync(CREDENTIALS_FILE, 0o600) } catch { /* best-effort on platforms without chmod */ }
}

/**
 * The `apiKeySetting` row's key, or undefined when none is stored.
 *
 * Its own accessor rather than a loadCredentials() field: loadCredentials()
 * returns null for a file carrying ONLY a key (no host), which would make the
 * settings panel report a key in force as "not set" and hide a credential that is
 * really there.
 */
export function loadApiKey(): string | undefined {
  const apiKey = readFile()?.apiKey
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined
}

/**
 * Store the `apiKeySetting` row's key, or CLEAR it when `key` is blank.
 *
 * Everything else in the credential file is left alone: a /login session, an
 * oauth grant and a relay key all survive an api-key change, so setting the key
 * does not silently log the user out.
 */
export function saveApiKey(key: string): void {
  const next: Partial<Credentials> = { ...(readFile() ?? {}), savedAt: Date.now() }
  const trimmed = key.trim()
  if (trimmed) next.apiKey = trimmed
  else delete next.apiKey
  write(next)
}

export function loadCredentials(): Credentials | null {
  const raw = readFile()
  if (!raw) return null
  // Valid when there's a base plus SOME usable credential: a relay key (pasted /
  // password login) or an OAuth access token (browser login) — OR an apiKeySetting
  // key on its own, which is a working credential with no host of its own (it runs
  // against whatever endpoint the current provider resolves). Requiring a host here
  // would report "logged out" for a key that is very much in force.
  const hasKey = typeof raw.key === 'string' && raw.key.length > 0
  const hasOAuth = typeof raw.oauth?.accessToken === 'string' && raw.oauth.accessToken.length > 0
  const hasApiKey = typeof raw.apiKey === 'string' && raw.apiKey.length > 0
  const hasBase = typeof raw.baseUrl === 'string' && !!raw.baseUrl
  if ((hasBase && (hasKey || hasOAuth)) || hasApiKey) {
    return { baseUrl: hasBase ? raw.baseUrl as string : '', ...raw } as Credentials
  }
  return null
}

export function saveCredentials(c: Credentials): void {
  write(c)
}

export function clearCredentials(): void {
  // The file is also the only copy of the apiKeySetting key, so /logout has to
  // read it out before wiping and put it back afterwards — see cmd.logout.
  try { fs.rmSync(CREDENTIALS_FILE, { force: true }) } catch { /* already gone */ }
}

// The rows whose value is a credential. `apiKeySetting` is the only one today.
const SECRETS = new Set(['apiKeySetting'])

/**
 * Which credential a request would actually use, in the order the providers
 * resolve them: the `apiKeySetting` row (config.ts, read first by
 * providers/anthropic.ts), then a /login relay key, then a /login OAuth grant,
 * then ANTHROPIC_API_KEY. null when none is present.
 *
 * The two halves are the two providers' own rules: `anthropic` reads the row and
 * falls back to the env var, while `newapi` authorizes with whatever /login wrote
 * — so a login outranks the env var, and the row (which providers/anthropic.ts
 * consults before anything else) outranks the login. A readout that disagreed
 * with that order would make /status and /doctor lie about the credential in
 * force.
 *
 * The row is resolved through loadApiKey(), i.e. the CREDENTIAL file — because
 * that file is the row's one home, so a key hand-edited into settings.json is not
 * in force and must not be reported as the source either.
 */
export function keySource(): 'setting' | 'login' | 'oauth' | 'env' | null {
  if (loadApiKey()) return 'setting'
  const raw = readFile()
  if (typeof raw?.key === 'string' && raw.key.length > 0) return 'login'
  if (typeof raw?.oauth?.accessToken === 'string' && raw.oauth.accessToken.length > 0) return 'oauth'
  if (process.env.ANTHROPIC_API_KEY) return 'env'
  return null
}

/**
 * A copy of the settings bag with every credential value replaced by a set/unset
 * marker — for the /api/config dump, /doctor, or any log that must not carry a
 * key. The KEY NAMES are kept, so a redacted dump still shows which credentials
 * exist; only their values are gone.
 */
export function redactSettings(
  bag: Record<string, boolean | string | number> | undefined,
): Record<string, boolean | string | number> {
  const out: Record<string, boolean | string | number> = {}
  for (const [k, v] of Object.entries(bag ?? {})) {
    out[k] = SECRETS.has(k) && String(v ?? '').trim() ? 'set' : v
  }
  return out
}
