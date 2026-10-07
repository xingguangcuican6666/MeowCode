// Network egress guard for the web tools. `web_fetch` takes a model-supplied URL,
// so without a check it is a request forgery primitive: the model (or text it read
// on a page) could aim it at the loopback interface, at a private LAN address, or
// at a cloud instance-metadata endpoint, and the reply would come back as tool
// output. Everything here exists to keep an agent-initiated fetch pointed at the
// public internet:
//
//   - The hostname is RESOLVED first and every address it answers with is checked,
//     so a public name that maps to 127.0.0.1 (or to a metadata address) is refused
//     before a socket is opened.
//   - Redirects are followed MANUALLY, one hop at a time, each hop re-validated —
//     `redirect: 'follow'` would hand the decision to the server.
//   - The body is read through a byte cap, so a huge (or endless) response cannot
//     exhaust memory.
//
// `MEOWCODE_ALLOW_PRIVATE_FETCH=1` opts out (for someone pointing the agent at a
// local dev server on purpose).
import dnsp from 'node:dns/promises'

// ---- address classification -------------------------------------------------

/** Parse dotted-quad IPv4 to a uint32, or null when it isn't one. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = ((n << 8) | v) >>> 0
  }
  return n >>> 0
}

function inCidr4(ip: number, cidr: string): boolean {
  const slash = cidr.indexOf('/')
  const base = ipv4ToInt(cidr.slice(0, slash))
  const bits = Number(cidr.slice(slash + 1))
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0)
}

// Everything that isn't a globally routable destination: this-network, RFC1918,
// CGNAT, loopback, link-local (169.254.169.254 — the cloud metadata address — lives
// here), the IETF protocol/benchmark/documentation blocks, multicast and reserved.
const V4_BLOCKED = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
]

/** Expand an IPv6 literal (including an embedded IPv4 tail) to 8 16-bit groups. */
function ipv6ToGroups(raw: string): number[] | null {
  let s = raw.split('%')[0].trim()
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  if (!s.includes(':')) return null
  // `::ffff:1.2.3.4` / `64:ff9b::1.2.3.4` — rewrite the dotted tail as two groups.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const n = ipv4ToInt(tail)
    if (n === null) return null
    s = `${s.slice(0, lastColon + 1)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (txt: string): number[] | null => {
    if (!txt) return []
    const out: number[] = []
    for (const h of txt.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null
      out.push(parseInt(h, 16))
    }
    return out
  }
  const head = parse(halves[0])
  if (!head) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const rest = parse(halves[1])
  if (!rest) return null
  const fill = 8 - head.length - rest.length
  if (fill < 0) return null
  return [...head, ...new Array<number>(fill).fill(0), ...rest]
}

function v6Prefix(g: number[], bits: number): number[] {
  const out = g.slice(0, 8)
  for (let i = 0; i < 8; i++) {
    const lo = i * 16
    if (lo >= bits) out[i] = 0
    else if (lo + 16 > bits) out[i] &= (0xffff << (lo + 16 - bits)) & 0xffff
  }
  return out
}
const eqPrefix = (g: number[], literal: string, bits: number): boolean => {
  const want = ipv6ToGroups(literal)
  if (!want) return false
  const a = v6Prefix(g, bits)
  const b = v6Prefix(want, bits)
  return a.every((v, i) => v === b[i])
}

/**
 * Is this IP literal something an agent-initiated fetch must not reach?
 * Unparseable input counts as unsafe — a guard that fails open is not a guard.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4ToInt(ip)
  if (v4 !== null) return V4_BLOCKED.some((c) => inCidr4(v4, c)) || v4 === 0xffffffff
  const g = ipv6ToGroups(ip)
  if (!g) return true
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry a v4 address:
  // judge it by the v4 rules, else ::ffff:127.0.0.1 would walk straight through.
  if (eqPrefix(g, '::ffff:0:0', 96) || eqPrefix(g, '64:ff9b::', 96)) {
    const v = ((g[6] << 16) | g[7]) >>> 0
    return V4_BLOCKED.some((c) => inCidr4(v, c)) || v === 0xffffffff
  }
  if (g.every((x) => x === 0)) return true                       // ::
  if (eqPrefix(g, '::1', 128)) return true                       // loopback
  if (eqPrefix(g, '100::', 64)) return true                      // discard-only
  if (eqPrefix(g, '2001:db8::', 32)) return true                 // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true                    // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true                    // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true                    // ff00::/8 multicast
  return false
}

export function privateFetchAllowed(): boolean {
  const v = process.env.MEOWCODE_ALLOW_PRIVATE_FETCH
  return v === '1' || v === 'true'
}

// ---- URL validation ---------------------------------------------------------

export interface UrlVerdict { ok: boolean; reason?: string }

/**
 * Resolve `url`'s host and refuse it unless every address it answers with is
 * publicly routable. Also refuses non-http(s) schemes and embedded credentials.
 */
export async function checkUrl(url: string): Promise<UrlVerdict> {
  let u: URL
  try { u = new URL(url) } catch { return { ok: false, reason: 'not a valid URL' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `scheme ${u.protocol} is not allowed (http/https only)` }
  if (u.username || u.password) return { ok: false, reason: 'URLs with embedded credentials are not allowed' }
  if (privateFetchAllowed()) return { ok: true }

  const host = u.hostname.replace(/^\[|\]$/g, '')
  // `localhost` (and friends) may not resolve at all in a sandbox; name-check first.
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
    return { ok: false, reason: `${host} is a local/internal name` }
  }
  // A literal address needs no lookup.
  if (ipv4ToInt(host) !== null || host.includes(':')) {
    return isBlockedIp(host)
      ? { ok: false, reason: `${host} is not a public address (loopback/private/link-local/reserved)` }
      : { ok: true }
  }
  let addrs: { address: string }[]
  try {
    addrs = await dnsp.lookup(host, { all: true, verbatim: true })
  } catch (e) {
    return { ok: false, reason: `cannot resolve ${host}: ${(e as Error).message}` }
  }
  if (!addrs.length) return { ok: false, reason: `${host} resolved to no addresses` }
  // Conservative: ONE private answer refuses the whole name (a split-horizon or
  // rebinding answer must not get a second chance on retry).
  const bad = addrs.find((a) => isBlockedIp(a.address))
  if (bad) return { ok: false, reason: `${host} resolves to ${bad.address}, which is not a public address` }
  return { ok: true }
}

// ---- guarded fetch ----------------------------------------------------------

export interface GuardedOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  /** Hard cap on bytes read from the body (default 5 MB). */
  maxBytes?: number
  /** How many redirects to follow (default 5). */
  maxRedirects?: number
}

export interface GuardedResult {
  ok: boolean
  status: number
  url: string                 // the final URL after redirects
  headers: Headers
  bytes: Uint8Array           // the (possibly truncated) body
  truncated: boolean
}

/** Thrown when the guard refuses a URL (initial or any redirect hop). */
export class BlockedUrlError extends Error {}

/**
 * fetch() with the guard applied to every hop and a byte cap on the body.
 * Returns raw bytes — the caller decides the charset (see decodeBody in web.ts).
 */
export async function guardedFetch(rawUrl: string, opts: GuardedOptions = {}): Promise<GuardedResult> {
  const maxBytes = opts.maxBytes ?? 5_000_000
  const maxRedirects = opts.maxRedirects ?? 5
  let url = rawUrl
  let method = opts.method ?? 'GET'
  let body = opts.body

  for (let hop = 0; ; hop++) {
    const verdict = await checkUrl(url)
    if (!verdict.ok) throw new BlockedUrlError(`${url} refused — ${verdict.reason}`)
    const res = await fetch(url, { method, headers: opts.headers, body, redirect: 'manual', signal: opts.signal })
    // 3xx with a Location: re-validate the target ourselves instead of letting
    // the platform follow it.
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (loc) {
      if (hop >= maxRedirects) throw new BlockedUrlError(`too many redirects (>${maxRedirects}) starting at ${rawUrl}`)
      let next: string
      try { next = new URL(loc, url).toString() } catch { throw new BlockedUrlError(`invalid redirect target "${loc}" from ${url}`) }
      // 303 (and the de-facto rule for 301/302) turns a POST into a GET and drops
      // the body; 307/308 keep both.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')) {
        method = 'GET'
        body = undefined
      }
      try { await res.body?.cancel() } catch { /* nothing to drain */ }
      url = next
      continue
    }
    const { bytes, truncated } = await readCapped(res, maxBytes)
    return { ok: res.ok, status: res.status, url, headers: res.headers, bytes, truncated }
  }
}

/** Read a response body, stopping at `maxBytes` and cancelling the rest. */
async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { bytes: new Uint8Array(0), truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const room = maxBytes - total
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room))
      total += room
      truncated = true
      try { await reader.cancel() } catch { /* already closed */ }
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }
  return { bytes, truncated }
}
