import { describe, it, expect, vi, afterEach } from 'vitest'
import { webFetch } from './web'

const ctx = { cwd: process.cwd() } as never

afterEach(() => { vi.unstubAllGlobals(); delete process.env.MEOWCODE_ALLOW_PRIVATE_FETCH })

// A fetch stub: one response, and a record of what was requested.
function stubFetch(body: Uint8Array | string, headers: Record<string, string> = {}, status = 200): { calls: string[] } {
  const calls: string[] = []
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url))
    return new Response(bytes, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
  })
  return { calls }
}

describe('web_fetch guards', () => {
  it('refuses loopback and metadata addresses without fetching', async () => {
    const { calls } = stubFetch('should never be read')
    for (const url of ['http://127.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/x']) {
      const r = await webFetch.run({ url }, ctx)
      expect(r.isError, url).toBe(true)
      expect(String(r.content)).toMatch(/refused|not a public|local\/internal/)
    }
    expect(calls).toEqual([])
  })

  it('refuses a non-http scheme', async () => {
    const r = await webFetch.run({ url: 'file:///etc/passwd' }, ctx)
    expect(r.isError).toBe(true)
  })

  it('does not follow a redirect into a private address', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url))
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9000/secret' } })
      return new Response('leaked', { status: 200 })
    })
    const r = await webFetch.run({ url: 'https://1.1.1.1/start' }, ctx)
    expect(r.isError).toBe(true)
    expect(String(r.content)).toContain('refused')
    expect(calls).toHaveLength(1)   // the redirect target was never requested
  })

  it('MEOWCODE_ALLOW_PRIVATE_FETCH=1 allows a local address', async () => {
    process.env.MEOWCODE_ALLOW_PRIVATE_FETCH = '1'
    stubFetch('<html><body>dev server</body></html>')
    const r = await webFetch.run({ url: 'http://127.0.0.1:3000/' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(String(r.content)).toContain('dev server')
  })
})

describe('web_fetch body handling', () => {
  it('strips scripts/styles and keeps readable text', async () => {
    stubFetch(`<html><head><title>t</title><style>body{color:red}</style></head>
      <body><script>var x = "<p>not text</p>"</script>
      <h1>Hello</h1><p>First para</p><ul><li>one</li><li>two</li></ul></body></html>`)
    const r = await webFetch.run({ url: 'https://1.1.1.1/page' }, ctx)
    const text = String(r.content)
    expect(text).toContain('Hello')
    expect(text).toContain('First para')
    expect(text).toContain('- one')
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('not text')
  })

  it('decodes a non-UTF-8 charset from the header', async () => {
    // "中文" in GBK.
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    stubFetch(gbk, { 'content-type': 'text/plain; charset=gbk' })
    const r = await webFetch.run({ url: 'https://1.1.1.1/gbk' }, ctx)
    expect(String(r.content)).toContain('中文')
  })

  it('reports a body truncated at the byte cap', async () => {
    // 6 MB of HTML — over the 5 MB cap.
    const big = '<p>' + 'a'.repeat(6_000_000) + '</p>'
    stubFetch(big)
    const r = await webFetch.run({ url: 'https://1.1.1.1/big', max_chars: 600 }, ctx)
    expect(r.isError).toBeFalsy()
    expect(String(r.content)).toContain('body capped at')
  })

  it('survives pathological unclosed tags', async () => {
    const nasty = '<div>'.repeat(20000) + '<script>' + 'x'.repeat(200000)
    stubFetch(nasty)
    const started = process.hrtime.bigint()
    const r = await webFetch.run({ url: 'https://1.1.1.1/nasty' }, ctx)
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    expect(r.isError).toBeFalsy()
    expect(ms).toBeLessThan(3000)
  })
})
