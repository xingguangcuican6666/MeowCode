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
    } finally { await open.close() }
  })
})
