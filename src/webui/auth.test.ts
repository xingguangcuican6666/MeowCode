import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import net from 'node:net'
import { createWebUIServer } from './server'
import type { WebUIServerInstance } from './types'

// `fetch` refuses to set Host (a forbidden header), so a rebinding request has to
// go out over a raw socket. Returns the response's status line.
function rawRequest(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(lines.join('\r\n') + '\r\n\r\n'))
    let buf = ''
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error('timeout')) })
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      if (buf.includes('\r\n')) { sock.destroy(); resolve(buf.split('\r\n')[0]) }
    })
    sock.on('error', reject)
  })
}

// The WebUI drives the agent with bypassPermissions and `/api/tools/call` reaches
// any tool, so reaching the API must require this run's token AND come from our own
// page. Binding to loopback is not by itself a boundary: any page in the user's
// browser can POST to 127.0.0.1, and a hostname that resolves to 127.0.0.1 defeats
// a socket-level check.
describe('WebUI access control', () => {
  let instance: WebUIServerInstance
  const port = 44571
  const base = `http://127.0.0.1:${port}`

  beforeAll(async () => {
    instance = createWebUIServer({ port, host: '127.0.0.1', openBrowser: false })
    await new Promise<void>((resolve) => { (instance as unknown as { listen: (p: number, cb: () => void) => void }).listen(port, resolve) })
  })
  afterAll(async () => { await instance?.close() })

  it('issues a token and embeds it in the served page', async () => {
    expect(instance.token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    const html = await (await fetch(`${base}/`)).text()
    expect(html).toContain('__MEOWCODE_API_TOKEN__')
    expect(html).toContain(JSON.stringify(instance.token))
  })

  it('refuses /api without a token', async () => {
    for (const [path, init] of [
      ['/api/session/state', {}],
      ['/api/tools', {}],
      ['/api/config', {}],
    ] as Array<[string, RequestInit]>) {
      const res = await fetch(base + path, init)
      expect(res.status, path).toBe(401)
    }
  })

  it('refuses a tool call without a token', async () => {
    const res = await fetch(`${base}/api/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bash', input: { command: 'echo pwned' } }),
    })
    expect(res.status).toBe(401)
  })

  it('refuses a wrong token', async () => {
    const res = await fetch(`${base}/api/tools`, { headers: { 'X-MeowCode-Token': 'not-the-token' } })
    expect(res.status).toBe(401)
  })

  it('accepts the token in a header or the query string', async () => {
    expect((await fetch(`${base}/api/tools`, { headers: { 'X-MeowCode-Token': instance.token } })).status).toBe(200)
    expect((await fetch(`${base}/api/tools?token=${encodeURIComponent(instance.token)}`)).status).toBe(200)
    expect((await fetch(`${base}/api/tools`, { headers: { authorization: `Bearer ${instance.token}` } })).status).toBe(200)
  })

  it('serves the page itself without a token (it carries one)', async () => {
    for (const path of ['/', '/style.css', '/app.js', '/sdk.js']) {
      expect((await fetch(base + path)).status, path).toBe(200)
    }
  })

  it('refuses a cross-origin request even with the token', async () => {
    const res = await fetch(`${base}/api/tools`, {
      headers: { 'X-MeowCode-Token': instance.token, origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('never answers with a wildcard CORS origin', async () => {
    for (const origin of [undefined, `http://127.0.0.1:${port}`, 'https://evil.example']) {
      const res = await fetch(`${base}/api/tools`, {
        headers: { 'X-MeowCode-Token': instance.token, ...(origin ? { origin } : {}) },
      })
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
    }
  })

  it('allows our own page as an origin', async () => {
    const res = await fetch(`${base}/api/tools`, {
      headers: { 'X-MeowCode-Token': instance.token, origin: `http://localhost:${port}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(`http://localhost:${port}`)
  })

  it('refuses a preflight from a foreign origin', async () => {
    const res = await fetch(`${base}/api/tools/call`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a rebound Host header', async () => {
    // What a DNS-rebinding attack looks like on the wire: the socket is loopback,
    // but the browser addressed a name the attacker controls.
    const status = await rawRequest(port, [
      'GET /api/tools HTTP/1.1',
      'Host: evil.example',
      `X-MeowCode-Token: ${instance.token}`,
      'Connection: close',
    ])
    expect(status).toContain('403')
  })

  it('still answers a loopback Host', async () => {
    const status = await rawRequest(port, [
      'GET /api/tools HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      `X-MeowCode-Token: ${instance.token}`,
      'Connection: close',
    ])
    expect(status).toContain('200')
  })

  it('auth:false opts out (for a trusted, isolated context)', async () => {
    const open = createWebUIServer({ port: port + 1, host: '127.0.0.1', openBrowser: false, auth: false })
    await new Promise<void>((resolve) => { (open as unknown as { listen: (p: number, cb: () => void) => void }).listen(port + 1, resolve) })
    try {
      expect(open.token).toBe('')
      expect((await fetch(`http://127.0.0.1:${port + 1}/api/tools`)).status).toBe(200)
      // The security probe tells the client not to bother with an exchange.
      const sec = await (await fetch(`http://127.0.0.1:${port + 1}/api/security`)).json()
      expect(sec).toMatchObject({ authRequired: false, bypass: true, authenticated: true })
      // And /api/auth must not mint a cookie for a server that ignores it.
      const auth = await fetch(`http://127.0.0.1:${port + 1}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'anything' }),
      })
      expect(auth.headers.get('set-cookie')).toBeNull()
    } finally { await open.close() }
  })
})

// The fragment→cookie exchange: the two routes the client (client/sdk.ts) calls
// before it holds any credential, tested against the REAL server rather than a
// mock. These existed, were deleted in a rewrite while the client kept calling
// them, and NOTHING here went red — because the only auth coverage asserted the
// blanket gate, never the exchange that gets a browser PAST it. A client-side
// test cannot catch that: it mocks its own server. See the two-halves rule in
// the project memory.
describe('WebUI fragment→cookie exchange', () => {
  let instance: WebUIServerInstance
  const port = 44573
  const base = `http://127.0.0.1:${port}`
  const origin = { Origin: base }

  // The token the browser can reuse without script: pull it out of Set-Cookie.
  const cookieFrom = (res: Response): string => {
    const raw = res.headers.get('set-cookie') || ''
    const m = /meowcode_token=([^;]+)/.exec(raw)
    return m ? `meowcode_token=${m[1]}` : ''
  }
  const postAuth = (token: unknown, extra: Record<string, string> = {}): Promise<Response> =>
    fetch(`${base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...origin, ...extra },
      body: typeof token === 'string' && token === '__RAW_BAD_JSON__' ? '{oops' : JSON.stringify({ token }),
    })

  beforeAll(async () => {
    instance = createWebUIServer({ port, host: '127.0.0.1', openBrowser: false })
    await new Promise<void>((resolve) => { (instance as unknown as { listen: (p: number, cb: () => void) => void }).listen(port, resolve) })
  })
  afterAll(async () => { await instance?.close() })

  it('GET /api/security is public and reports the requirement without the token', async () => {
    const res = await fetch(`${base}/api/security`, { headers: origin })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ authRequired: true, bypass: false, authenticated: false })
    // The requirement's SHAPE, never the credential itself.
    expect(JSON.stringify(body)).not.toContain(instance.token)
  })

  it('POST /api/auth with the right token sets a persistent HttpOnly cookie', async () => {
    const res = await postAuth(instance.token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authenticated: true, authRequired: true, bypass: false })
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain('meowcode_token=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    // Max-Age is the whole point of a STABLE token — a session cookie would make
    // the bookmarked URL stop working after a browser restart.
    expect(setCookie).toMatch(/Max-Age=\d{5,}/)
  })

  it('the cookie it mints then authenticates the API and the SSE stream', async () => {
    const cookie = cookieFrom(await postAuth(instance.token))
    expect(cookie).not.toBe('')
    // A normal API call carrying only the cookie — no header, no query token.
    const state = await fetch(`${base}/api/session/state`, { headers: { ...origin, cookie } })
    expect(state.status).toBe(200)
    // And SSE, which can ONLY carry a cookie (EventSource sends no headers).
    const sse = await fetch(`${base}/api/events`, { headers: { ...origin, cookie, Accept: 'text/event-stream' } })
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type')).toContain('text/event-stream')
    await sse.body?.cancel()
    // /api/security now reports this request as authenticated, off the cookie.
    const sec = await (await fetch(`${base}/api/security`, { headers: { ...origin, cookie } })).json() as { authenticated: boolean }
    expect(sec.authenticated).toBe(true)
  })

  it('refuses a wrong token, a non-string token, and malformed JSON — distinctly', async () => {
    expect((await postAuth('not-the-token')).status).toBe(401)
    expect((await postAuth(12345)).status).toBe(400)       // a number must not String() into a compare
    expect((await postAuth('')).status).toBe(400)
    expect((await postAuth('   ')).status).toBe(400)
    expect((await postAuth('__RAW_BAD_JSON__')).status).toBe(400)
    // None of the refusals left a cookie behind.
    for (const bad of ['not-the-token', 12345, '']) {
      expect(cookieFrom(await postAuth(bad))).toBe('')
    }
  })

  it('an explicit wrong token is refused even when a valid cookie rides along', async () => {
    // The failure this guards: query/header precedence that drops the cookie would
    // make a rejected token read the same as no token. Here a GOOD cookie must not
    // rescue a BAD explicit token — otherwise the unlock form can never report
    // "that token is wrong" to a browser that already has a stale cookie.
    const cookie = cookieFrom(await postAuth(instance.token))
    const res = await postAuth('not-the-token', { cookie })
    expect(res.status).toBe(401)
  })

  it('still enforces Host and Origin — a foreign origin cannot run the exchange', async () => {
    const res = await postAuth(instance.token, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    const sec = await fetch(`${base}/api/security`, { headers: { Origin: 'https://evil.example' } })
    expect(sec.status).toBe(403)
  })

  it('does NOT exempt /api/i18n — a locked page draws its gate from the boot catalog', async () => {
    // Only /api/auth and /api/security are public. /api/i18n behind the gate is
    // deliberate: the page ships a static boot catalog so a locked first visit can
    // still render the gate, rather than opening the catalog to the unauthed.
    expect((await fetch(`${base}/api/i18n`, { headers: origin })).status).toBe(401)
  })
})

