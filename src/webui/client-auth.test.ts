import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { CLIENT_SDK_JS } from './client/sdk'

/**
 * The WebUI's auth handshake, executed rather than grepped.
 *
 * The SDK is served as a plain script and its whole job is what the BROWSER does
 * with a URL — read the token, POST it, take the cookie, scrub the bar. Asserting
 * on its source proves nothing about that: the bug this file exists for (a token
 * pasted into the gate was rejected) shipped with every relevant string present in
 * the source. So the script runs in a VM with a minimal browser — one fetch stub,
 * one history, one address bar — and the cookie is only real if the stub set it.
 */

const TOKEN = 'the-real-token'
const ORIGIN = 'http://127.0.0.1:4040'

interface Call { url: string; method: string; body?: string | null }

interface Harness {
  auth: { authRequired: boolean; bypass: boolean; authenticated: boolean }
  /** What history.replaceState last wrote — i.e. what the address bar now reads. */
  addressBar: string
  calls: Call[]
  /** The URL each fetch saw, in order, so the probe order can be asserted. */
  i18nCalls: number
}

interface RunOpts {
  url: string
  /** A cookie the browser already holds from an earlier visit. */
  cookie?: string
  /** Serve the server as --no-auth does. */
  bypass?: boolean
  /** Make /api/auth answer 401 for anything. */
  failAuth?: boolean
}

async function runSdk(opts: RunOpts): Promise<Harness> {
  const calls: Call[] = []
  const replaced: string[] = []
  const cookie = new URLSearchParams(opts.cookie ?? '')

  const start = new URL(opts.url)
  const location = { pathname: start.pathname, search: start.search, hash: start.hash }

  const fetchStub: typeof fetch = async (input, init) => {
    const path = String(input)
    calls.push({ url: path, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null })
    const route = new URL(path, ORIGIN).pathname
    const json = (status: number, data: unknown): Response =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

    if (route === '/api/auth') {
      if (opts.failAuth) return json(401, { error: 'Invalid token' })
      const sent = JSON.parse(String(init?.body ?? '{}')).token
      if (sent !== TOKEN) return json(401, { error: 'Invalid token' })
      cookie.set('meowcode_token', TOKEN)
      return json(200, { ok: true, authRequired: true, bypass: false, authenticated: true })
    }
    if (route === '/api/security') {
      return json(200, {
        authRequired: !opts.bypass,
        bypass: opts.bypass === true,
        authenticated: opts.bypass === true || cookie.has('meowcode_token'),
      })
    }
    if (route === '/api/session/state') {
      return cookie.has('meowcode_token') ? json(200, { messages: [] }) : json(401, { error: 'no' })
    }
    return json(200, { lang: 'zh', messages: {} })
  }

  const sandbox: Record<string, unknown> = {
    console,
    Response,
    Headers,
    URL,
    Map,
    Set,
    Promise,
    setTimeout: () => 0,
    fetch: fetchStub,
    location,
    history: { replaceState: (_state: unknown, _title: string, next: string) => { replaced.push(next) } },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { language: 'zh-CN' },
    crypto: { randomUUID: () => 'tab-1' },
    EventSource: class {},
    customElements: { define: () => {} },
    document: {
      readyState: 'complete',
      documentElement: { setAttribute: () => {} },
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
      head: { appendChild: () => {} },
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: () => null,
      querySelector: () => null,
    },
    window: {
      MeowSDK: null,
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      __MEOWCODE_BOOT_I18N__: { lang: 'zh', messages: {} },
    },
  }
  sandbox.globalThis = sandbox

  vm.createContext(sandbox)
  vm.runInContext(CLIENT_SDK_JS, sandbox, { filename: 'sdk.js' })

  const sdk = (sandbox.window as { MeowSDK: Record<string, unknown> }).MeowSDK as {
    auth: { ready: Promise<unknown>; state: Harness['auth'] }
  }
  await sdk.auth.ready

  return {
    auth: sdk.auth.state,
    addressBar: replaced[replaced.length - 1] ?? '',
    calls,
    i18nCalls: calls.filter((c) => c.url.startsWith('/api/i18n')).length,
  }
}

/**
 * The handshake's own round-trips. /api/i18n is excluded: it rides authReady
 * afterwards, so it says nothing about the order of the exchange itself.
 */
const routes = (calls: Call[]): string[] =>
  calls.map((c) => new URL(c.url, ORIGIN).pathname).filter((p) => p !== '/api/i18n')

describe('WebUI SDK auth handshake (executed)', () => {
  it('spends the fragment token, then scrubs the address bar', async () => {
    const r = await runSdk({ url: `${ORIGIN}/#token=${TOKEN}` })
    expect(r.auth.authenticated).toBe(true)
    // The probe rides no credential, so it can only be answered by a public route.
    expect(routes(r.calls)).toEqual(['/api/security', '/api/auth'])
    expect(JSON.parse(String(r.calls[1].body)).token).toBe(TOKEN)
    expect(r.addressBar).toBe('/')
  })

  it('still accepts the ?token= links earlier builds printed, and scrubs those too', async () => {
    // The exact shape a user reported as "still needs auth": a query param, not a
    // fragment. A link sitting in their history has to keep working.
    const r = await runSdk({ url: `${ORIGIN}/?token=${TOKEN}` })
    expect(r.auth.authenticated).toBe(true)
    expect(routes(r.calls)).toEqual(['/api/security', '/api/auth'])
    expect(r.addressBar).toBe('/')
  })

  it('scrubs before the exchange resolves, not after it', async () => {
    // Otherwise a slow POST /api/auth leaves the credential in the bar for the
    // whole round-trip — the one window where a screenshot catches it.
    let barWhenExchangeStarted: string | null = null
    const seen: string[] = []
    const start = new URL(`${ORIGIN}/#token=${TOKEN}`)
    const location = { pathname: start.pathname, search: start.search, hash: start.hash }
    const sandbox: Record<string, unknown> = {
      console, Response, Headers, URL, Map, Set, Promise, setTimeout: () => 0,
      location,
      history: { replaceState: (_s: unknown, _t: string, next: string) => { seen.push(next) } },
      localStorage: { getItem: () => null, setItem: () => {} },
      navigator: { language: 'zh-CN' },
      crypto: { randomUUID: () => 'tab-1' },
      EventSource: class {},
      customElements: { define: () => {} },
      document: {
        readyState: 'complete', documentElement: { setAttribute: () => {} },
        createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
        head: { appendChild: () => {} }, addEventListener: () => {},
        querySelectorAll: () => [], getElementById: () => null, querySelector: () => null,
      },
      window: {
        MeowSDK: null, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        __MEOWCODE_BOOT_I18N__: { lang: 'zh', messages: {} },
      },
      fetch: async (input: string) => {
        const route = new URL(String(input), ORIGIN).pathname
        if (route === '/api/auth') barWhenExchangeStarted = seen[seen.length - 1] ?? null
        const data = route === '/api/security' ? { authRequired: true, bypass: false, authenticated: false } : {}
        return new Response(JSON.stringify(route === '/api/auth' ? { ok: true } : data), { status: 200 })
      },
    }
    sandbox.globalThis = sandbox
    vm.createContext(sandbox)
    vm.runInContext(CLIENT_SDK_JS, sandbox, { filename: 'sdk.js' })
    const sdk = (sandbox.window as { MeowSDK: Record<string, unknown> }).MeowSDK as { auth: { ready: Promise<unknown> } }
    await sdk.auth.ready
    // By the time the POST was under way the bar had already been rewritten.
    expect(barWhenExchangeStarted).toBe('/')
  })

  it('keeps a good cookie across a visit with no token in the URL', async () => {
    const r = await runSdk({ url: `${ORIGIN}/`, cookie: `meowcode_token=${TOKEN}` })
    expect(r.auth.authenticated).toBe(true)
    // No token to spend: a bare probe, then the cookie answers the state check
    // on its own — no exchange is even attempted.
    expect(routes(r.calls)).toEqual(['/api/security', '/api/session/state'])
    expect(r.addressBar).toBe('')
  })

  it('stays locked on a wrong token, and says so', async () => {
    const r = await runSdk({ url: `${ORIGIN}/#token=not-the-token` })
    expect(r.auth.authenticated).toBe(false)
    expect(r.calls.filter((c) => c.url === '/api/auth')).toHaveLength(1)
    // The wrong one is still scrubbed — it was a credential in the bar either way.
    expect(r.addressBar).toBe('/')
  })

  it('stays locked when there is no credential at all', async () => {
    const r = await runSdk({ url: `${ORIGIN}/` })
    expect(r.auth.authenticated).toBe(false)
    expect(r.addressBar).toBe('')
  })

  it('survives a malformed percent-escape in the token', async () => {
    // A hand-edited or half-pasted link must not take the page down over the
    // credential: decode, fail the exchange, land in the gate.
    const r = await runSdk({ url: `${ORIGIN}/#token=%E0%A4%A`, cookie: `meowcode_token=${TOKEN}` })
    expect(r.auth.authenticated).toBe(true)
    expect(r.addressBar).toBe('/')
  })

  it('re-reads the full catalog once the cookie is in hand', async () => {
    // A locked-out first visit only ever had the boot table, so the catalog fetch
    // is the thing that must start riding the cookie.
    const r = await runSdk({ url: `${ORIGIN}/#token=${TOKEN}` })
    expect(r.i18nCalls).toBe(1)
    const locked = await runSdk({ url: `${ORIGIN}/` })
    // Behind the token, so the 401 is its normal first frame — not a crash.
    expect(locked.auth.authenticated).toBe(false)
  })

  it('goes straight in under --no-auth, without an exchange', async () => {
    const r = await runSdk({ url: `${ORIGIN}/`, bypass: true })
    expect(r.auth.authenticated).toBe(true)
    expect(r.auth.bypass).toBe(true)
    expect(routes(r.calls)).toEqual(['/api/security'])
  })

  it('stays locked when the exchange itself fails', async () => {
    // The server is gone, not the token wrong: the gate must appear rather than
    // the page hanging on a promise nobody catches.
    const r = await runSdk({ url: `${ORIGIN}/#token=${TOKEN}`, failAuth: true })
    expect(r.auth.authenticated).toBe(false)
  })

  it('translates the gate from the inlined boot catalog, with no /api/i18n fetch', async () => {
    // The gate renders BEFORE authentication, and /api/i18n is behind the token,
    // so a locked page could never fetch the catalog — it drew the gate in raw key
    // names ("显示的都是键名"). The server now inlines the catalog as
    // window.__MEOWCODE_BOOT_I18N__; the SDK must read it so t() resolves the gate
    // strings offline, and must then NOT spend a fetch on what it already holds.
    const calls: string[] = []
    const sandbox: Record<string, unknown> = {
      console, Response, Headers, URL, Map, Set, Promise, setTimeout: () => 0,
      location: { pathname: '/', search: '', hash: '' },
      history: { replaceState: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} },
      navigator: { language: 'en-US' },   // navigator says English…
      crypto: { randomUUID: () => 'tab-1' },
      EventSource: class {},
      customElements: { define: () => {} },
      document: {
        readyState: 'complete', documentElement: { setAttribute: () => {} },
        createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
        head: { appendChild: () => {} }, addEventListener: () => {},
        querySelectorAll: () => [], getElementById: () => null, querySelector: () => null,
      },
      window: {
        MeowSDK: null, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        // …but the server resolved the session to Chinese, and shipped the catalog.
        __MEOWCODE_BOOT_I18N__: {
          lang: 'zh',
          messages: {
            'auth.gate.title': { zh: '需要访问令牌', en: 'Access token required' },
            'auth.gate.badToken': { zh: '令牌无效，请从终端输出中复制完整令牌。', en: 'That token is not valid.' },
          },
        },
      },
      fetch: async (input: string) => {
        const route = new URL(String(input), ORIGIN).pathname
        calls.push(route)
        const data = route === '/api/security' ? { authRequired: true, bypass: false, authenticated: false } : {}
        return new Response(JSON.stringify(data), { status: 200 })
      },
    }
    sandbox.globalThis = sandbox
    vm.createContext(sandbox)
    vm.runInContext(CLIENT_SDK_JS, sandbox, { filename: 'sdk.js' })
    const sdk = (sandbox.window as { MeowSDK: Record<string, unknown> }).MeowSDK as {
      auth: { ready: Promise<unknown> }
      i18n: { t: (k: string) => string; getLang: () => string }
    }
    await sdk.auth.ready

    // The gate's own strings resolve to the translation, never the key.
    expect(sdk.i18n.t('auth.gate.title')).toBe('需要访问令牌')
    expect(sdk.i18n.t('auth.gate.badToken')).toBe('令牌无效，请从终端输出中复制完整令牌。')
    // The boot catalog decided the language — the server's resolution wins over
    // the browser's navigator.
    expect(sdk.i18n.getLang()).toBe('zh')
    // And the catalog was in hand, so no /api/i18n round-trip was spent on it.
    expect(calls.filter((c) => c === '/api/i18n')).toHaveLength(0)
  })
})