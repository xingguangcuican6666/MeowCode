// Web access tools — fetch a URL's readable text (`web_fetch`) and run a web
// search (`web_search`). Dependency-free: both use the global `fetch`, and HTML
// is reduced to text by a single-pass scanner rather than a parser dependency, so
// the tools work anywhere the CLI runs. Network egress is agent-initiated
// research (docs, error messages, library APIs); like the search tools they
// auto-run (not in tools/permission MUTATING). Not for authenticated/private
// pages — there's no cookie/credential handling here by design.
//
// The URL comes from the model, so every request goes through lib/net's guard:
// the host is resolved and checked against loopback/private/link-local/metadata
// ranges, redirects are re-validated hop by hop, and the body is read through a
// byte cap. See lib/net.ts.
import type { ToolDef, ToolResult } from './types'
import { clip } from './util'
import { guardedFetch, BlockedUrlError } from '../lib/net'

// Hard caps on what one fetch may pull into memory before any clipping.
const MAX_BODY_BYTES = 5_000_000
// Above this, HTML goes through the scanner in truncated form: a document this
// large is not a readable page, and the text we keep is far smaller anyway.
const MAX_HTML_CHARS = 2_000_000

// A browser-ish UA so servers that gate bare clients still answer. No cookies,
// no auth — this is public-page fetching only.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36 MeowCode/1.0'

// A signal that aborts on EITHER the turn's signal or a timeout, plus a cancel()
// to clear the timer. Kept manual (not AbortSignal.any) for portability across
// the Node/Bun versions the CLI runs on.
function timedSignal(outer: AbortSignal | undefined, ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), ms)
  const onAbort = (): void => ctrl.abort()
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener('abort', onAbort, { once: true })
  }
  return { signal: ctrl.signal, cancel: () => { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onAbort) } }
}

// Decode the HTML entities that survive tag-stripping (named + numeric).
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—',
    ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  }
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m
    }
    return named[e.toLowerCase()] ?? m
  })
}

// Strip inline tags from a small HTML fragment (a title/snippet), leaving text.
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

// Tags whose ENTIRE subtree is dropped (code, styling and page chrome).
const DROP_SUBTREE = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'nav', 'footer', 'header', 'aside', 'form'])
// Closing these ends a line of text.
const BLOCK_END = new Set(['p', 'div', 'section', 'article', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre'])

// Reduce a full HTML document to readable text. Single forward pass — no
// `[\s\S]*?` tag-pair regexes, which backtrack badly on unclosed tags in a big
// document. Not a faithful renderer: just enough that the model can read an
// article or a doc page.
function htmlToText(html: string): string {
  const src = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html
  const n = src.length
  const out: string[] = []
  let i = 0
  let dropping = ''        // tag name whose subtree we're inside ('' = none)
  let depth = 0            // nesting of that same tag
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { if (!dropping) out.push(src.slice(i)); break }
    if (!dropping) out.push(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {                     // comment
      const e = src.indexOf('-->', lt + 4)
      i = e < 0 ? n : e + 3
      continue
    }
    const gt = src.indexOf('>', lt + 1)
    if (gt < 0) break                                     // unterminated tag: stop
    const raw = src.slice(lt + 1, gt)
    const closing = raw.charCodeAt(0) === 47              // '/'
    const name = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(closing ? raw.slice(1) : raw)?.[0].toLowerCase() ?? ''
    const selfClosing = raw.endsWith('/')
    if (dropping) {
      if (name === dropping) {
        if (closing) { depth--; if (depth <= 0) dropping = '' }
        else if (!selfClosing) depth++
      }
      i = gt + 1
      continue
    }
    if (!closing && !selfClosing && DROP_SUBTREE.has(name)) { dropping = name; depth = 1; i = gt + 1; continue }
    if (name === 'br') out.push('\n')
    else if (!closing && name === 'li') out.push('\n- ')
    else if (closing && BLOCK_END.has(name)) out.push('\n')
    else out.push(' ')
    i = gt + 1
  }
  let s = decodeEntities(out.join(''))
  s = s.replace(/[ \t\f\v\r]+/g, ' ')
  s = s.split('\n').map((l) => l.trim()).filter((l, idx, a) => l !== '' || (a[idx - 1] ?? '') !== '').join('\n')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

// Decode a response body with the charset the server (or the document) declares.
// Node's TextDecoder covers the common legacy labels (gbk, shift_jis, latin1…);
// an unknown label falls back to UTF-8 rather than throwing.
function decodeBody(bytes: Uint8Array, contentType: string): string {
  let label = /charset=\s*"?([\w:.-]+)/i.exec(contentType)?.[1]
  if (!label) {
    // Sniff a <meta charset> / <meta http-equiv> in the first 4 KB, ASCII-wise.
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096))
    label = /<meta[^>]+charset=\s*"?([\w:.-]+)/i.exec(head)?.[1]
      ?? /<meta[^>]+content=["'][^"']*charset=\s*([\w:.-]+)/i.exec(head)?.[1]
  }
  const tryLabel = (l: string): string | null => {
    try { return new TextDecoder(l, { fatal: false }).decode(bytes) } catch { return null }
  }
  if (label && !/^utf-?8$/i.test(label)) {
    const decoded = tryLabel(label)
    if (decoded !== null) return decoded
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function normalizeUrl(raw: string): string | null {
  const u = raw.trim()
  if (!u) return null
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`
  try { const parsed = new URL(withScheme); return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null } catch { return null }
}

// --- Domain allow/block filtering (Claude Code's allowed_domains/blocked_domains
// on WebFetch/WebSearch). A URL's host matches a domain when it equals it or is a
// subdomain of it; `www.` is ignored on both sides. Accepts an array or a
// comma-separated string.
function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}
function domainMatch(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '').trim()
  if (!d || !host) return false
  return host === d || host.endsWith('.' + d)
}
function parseDomains(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}
// Returns a rejection reason if `url` is not permitted by the allow/block lists,
// else null. Blocked wins over allowed; an empty allow list permits everything.
function domainRejection(url: string, allowed: string[], blocked: string[]): string | null {
  const host = hostOf(url)
  if (blocked.some((d) => domainMatch(host, d))) return `${host} is in blocked_domains`
  if (allowed.length && !allowed.some((d) => domainMatch(host, d))) return `${host} is not in allowed_domains`
  return null
}

const DOMAIN_SCHEMA = {
  allowed_domains: { type: 'array', items: { type: 'string' }, description: 'If set, only fetch/return results from these domains (subdomains included).' },
  blocked_domains: { type: 'array', items: { type: 'string' }, description: 'Never fetch/return results from these domains (subdomains included).' },
}

export const webFetch: ToolDef = {
  name: 'web_fetch',
  description:
    'Fetch a public URL over HTTP(S) and return its main text content (HTML is converted to readable text; JSON/plain text is returned as-is). ' +
    'Use for documentation, articles, API references, changelogs, and looking up error messages. ' +
    'Follows redirects. Not for authenticated or private pages (no cookies/credentials are sent).',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (http/https; scheme optional).' },
      max_chars: { type: 'number', description: 'Max characters of extracted text to return (default 20000).' },
      timeout_ms: { type: 'number', description: 'Request timeout in milliseconds (default 20000).' },
      ...DOMAIN_SCHEMA,
    },
    required: ['url'],
  },
  async run(input, ctx): Promise<ToolResult> {
    const url = normalizeUrl(String(input.url ?? ''))
    if (!url) return { content: 'web_fetch: invalid or non-http(s) URL', isError: true }
    const reject = domainRejection(url, parseDomains(input.allowed_domains), parseDomains(input.blocked_domains))
    if (reject) return { content: `web_fetch: refused — ${reject}`, isError: true }
    const maxChars = Math.max(500, Number(input.max_chars) || 20000)
    const { signal, cancel } = timedSignal(ctx.signal, Number(input.timeout_ms) || 20000)
    try {
      const res = await guardedFetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en,zh;q=0.8' },
        signal, maxBytes: MAX_BODY_BYTES,
      })
      if (!res.ok) return { content: `web_fetch: HTTP ${res.status} for ${res.url}`, isError: true }
      const ctype = (res.headers.get('content-type') || '').toLowerCase()
      const raw = decodeBody(res.bytes, ctype)
      const isHtml = ctype.includes('html') || /^\s*<(!doctype|html)/i.test(raw)
      const text = isHtml ? htmlToText(raw) : raw.trim()
      const clipped = text.length > maxChars ? text.slice(0, maxChars) + `\n\n… [truncated ${text.length - maxChars} chars; raise max_chars to read more]` : text
      const notes = [`${ctype || 'unknown type'}`, `${res.bytes.byteLength} bytes fetched`]
      if (res.truncated) notes.push(`body capped at ${MAX_BODY_BYTES} bytes`)
      if (res.url !== url) notes.push(`redirected to ${res.url}`)
      const header = `# ${url}\n(${notes.join(', ')})\n\n`
      return { content: clip(header + (clipped || '(no readable text extracted)'), maxChars + 500), display: `web_fetch · ${url} (${text.length} chars)` }
    } catch (e) {
      if (e instanceof BlockedUrlError) return { content: `web_fetch: ${e.message}. Only public http(s) addresses are allowed; set MEOWCODE_ALLOW_PRIVATE_FETCH=1 to reach a local address on purpose.`, isError: true }
      const msg = ctx.signal?.aborted ? '(aborted)' : (e as Error).message === 'timeout' || /abort/i.test((e as Error).message) ? 'request timed out' : (e as Error).message
      return { content: `web_fetch: failed to fetch ${url}: ${msg}`, isError: true }
    } finally { cancel() }
  },
}

// DuckDuckGo's no-JS HTML endpoint returns result anchors we can scrape without
// an API key. Result links are wrapped as //duckduckgo.com/l/?uddg=<encoded>;
// we unwrap them back to the real target.
function unwrapDdg(href: string): string {
  try {
    const m = /[?&]uddg=([^&]+)/.exec(href)
    if (m) return decodeURIComponent(m[1])
    if (href.startsWith('//')) return 'https:' + href
    return href
  } catch { return href }
}

interface SearchHit { title: string; url: string; snippet: string }

function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = []
  const linkRe = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snipRe = /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  const snippets: string[] = []
  let sm: RegExpExecArray | null
  while ((sm = snipRe.exec(html))) snippets.push(stripTags(sm[1]))
  let lm: RegExpExecArray | null
  let i = 0
  while ((lm = linkRe.exec(html)) && hits.length < limit) {
    const url = unwrapDdg(lm[1])
    const title = stripTags(lm[2])
    if (!title || !/^https?:/i.test(url)) { i++; continue }
    hits.push({ title, url, snippet: snippets[i] ?? '' })
    i++
  }
  return hits
}

export const webSearch: ToolDef = {
  name: 'web_search',
  description:
    'Search the web and return the top results (title, URL, snippet) for a query. ' +
    'Use to find documentation, solutions, current information, or candidate pages to then read with web_fetch. ' +
    'Results come from a keyless search backend, so ranking is approximate and the backend may occasionally rate-limit.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      count: { type: 'number', description: 'Max results to return (default 10, max 20).' },
      timeout_ms: { type: 'number', description: 'Request timeout in milliseconds (default 20000).' },
      ...DOMAIN_SCHEMA,
    },
    required: ['query'],
  },
  async run(input, ctx): Promise<ToolResult> {
    const query = String(input.query ?? '').trim()
    if (!query) return { content: 'web_search: `query` is required', isError: true }
    const limit = Math.min(20, Math.max(1, Number(input.count) || 10))
    const allowed = parseDomains(input.allowed_domains)
    const blocked = parseDomains(input.blocked_domains)
    const { signal, cancel } = timedSignal(ctx.signal, Number(input.timeout_ms) || 20000)
    try {
      const res = await guardedFetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', 'accept-language': 'en,zh;q=0.8' },
        body: `q=${encodeURIComponent(query)}`,
        signal, maxBytes: MAX_BODY_BYTES,
      })
      if (!res.ok) return { content: `web_search: search backend returned HTTP ${res.status}`, isError: true }
      const html = decodeBody(res.bytes, res.headers.get('content-type') || '')
      let hits = parseDdgHtml(html, allowed.length || blocked.length ? 50 : limit)
      if (allowed.length || blocked.length) {
        hits = hits.filter((h) => !domainRejection(h.url, allowed, blocked)).slice(0, limit)
      }
      if (hits.length === 0) return { content: `web_search: no results for "${query}" (the backend may have returned a challenge page, or the domain filters excluded everything — try rephrasing or use web_fetch on a known URL).` }
      const body = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`).join('\n\n')
      return { content: clip(`Results for "${query}":\n\n${body}`), display: `web_search · "${query}" (${hits.length} results)` }
    } catch (e) {
      const msg = ctx.signal?.aborted ? '(aborted)' : (e as Error).message === 'timeout' || /abort/i.test((e as Error).message) ? 'request timed out' : (e as Error).message
      return { content: `web_search: failed: ${msg}`, isError: true }
    } finally { cancel() }
  },
}
