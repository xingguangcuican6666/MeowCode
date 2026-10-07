import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The WebUI's access control, in two independent layers.
 *
 * 1. A per-process bearer token. The browser gets it once, in the URL *fragment*
 *    (`#token=…`, which never reaches the server or any proxy log), exchanges it
 *    for an HttpOnly cookie via /api/auth, and from then on authenticates by
 *    cookie — which is what lets `EventSource` attach credentials, since the SSE
 *    constructor cannot send headers.
 * 2. An origin allowlist. A reflected-origin CORS policy (echo the request's
 *    Origin) is the classic way to hand a localhost server's API to every website
 *    in the user's browser, so the reflection is conditional: the origin must be
 *    the same host the request arrived on (which is what "same origin" means),
 *    or a loopback alias.
 *
 * `bypass` (`--no-auth`) turns the token check off for the deliberate
 * "I want this reachable" case — reaching it from another device or through a
 * tunnel. It is never the default, and the origin allowlist stays on in bypass
 * mode, so exposing the server does not also expose it to every web page.
 */
export const AUTH_COOKIE = 'meowcode_token'

export interface WebUISecurityOptions {
  /** Skip the token check entirely. Explicit opt-in; see the note above. */
  bypass?: boolean
}

export interface AuthResult {
  ok: boolean
  /** 'missing' = no credential at all, 'bad' = one that does not match. */
  reason?: 'missing' | 'bad'
}

export interface WebUISecurity {
  /** The per-process token. Empty string in bypass mode. */
  readonly token: string
  readonly bypass: boolean
  readonly authRequired: boolean
  /** Layer 1. `ok` means the caller may use the API. */
  authenticate(req: IncomingMessage): AuthResult
  /** Layer 1, against a token the body carries rather than a header. */
  authenticateToken(presented: string): AuthResult
  /** Layer 2. A request with no Origin header is not a browser CORS request. */
  originAllowed(req: IncomingMessage): boolean
  /** The Origin to echo, or '' when the request's origin is not allowed. */
  reflectOrigin(req: IncomingMessage): string
  /** Set the auth cookie on a response that carried a valid token. */
  remember(res: ServerResponse): void
  /** What the client needs to know to render its auth state honestly. */
  status(): { authRequired: boolean; bypass: boolean; authenticated: boolean }
}

function tokenFrom(req: IncomingMessage): string {
  const auth = req.headers.authorization
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (m) return m[1].trim()
  }
  const cookies = req.headers.cookie
  if (cookies) {
    for (const part of cookies.split(';')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      if (part.slice(0, eq).trim() === AUTH_COOKIE) {
        try {
          return decodeURIComponent(part.slice(eq + 1).trim())
        } catch {
          return part.slice(eq + 1).trim()
        }
      }
    }
  }
  return ''
}

function tokenMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // timingSafeEqual throws on a length mismatch, so screen for that first.
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return timingSafeEqual(bufA, bufB)
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

export function createWebUISecurity(options: WebUISecurityOptions = {}): WebUISecurity {
  const bypass = options.bypass === true
  // 32 bytes of entropy per process. A fresh server is a fresh token, so a
  // token from an earlier run is dead — which is what "one-time" buys us.
  const token = bypass ? '' : randomBytes(32).toString('base64url')

  function authenticateToken(presented: string): AuthResult {
    if (bypass) return { ok: true }
    if (!presented) return { ok: false, reason: 'missing' }
    return tokenMatches(presented, token) ? { ok: true } : { ok: false, reason: 'bad' }
  }

  return {
    token,
    bypass,
    authRequired: !bypass,
    authenticate(req) {
      return authenticateToken(tokenFrom(req))
    },
    authenticateToken,
    originAllowed(req) {
      const origin = req.headers.origin
      if (!origin) return true
      let originHost: string
      try {
        originHost = new URL(origin).host
      } catch {
        return false
      }
      // Same-origin: the browser sent the host it addressed us on. Comparing
      // against the Host header (not the configured one) is what keeps this
      // correct behind a port-forward, on a LAN IP, or on a tunnel hostname.
      const host = String(req.headers.host || '')
      if (host && originHost.toLowerCase() === host.toLowerCase()) return true
      // Loopback aliases: 127.0.0.1 and localhost are different origins but the
      // same machine, and a dev proxy on another port is still the user.
      try {
        return isLoopbackHost(new URL(origin).hostname)
      } catch {
        return false
      }
    },
    reflectOrigin(req) {
      if (!req.headers.origin) return ''
      return this.originAllowed(req) ? String(req.headers.origin) : ''
    },
    remember(res) {
      // HttpOnly so a plugin script cannot read the credential; SameSite=Strict
      // so another site cannot ride it. No Secure: the default deployment is
      // plain http on localhost.
      res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`)
    },
    status() {
      return { authRequired: !bypass, bypass, authenticated: bypass }
    },
  }
}