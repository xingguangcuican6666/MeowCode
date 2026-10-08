import { describe, it, expect, afterAll, beforeAll, afterEach } from 'vitest'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// HOME moves BEFORE server.ts loads: startWebUI resolves the token through
// token-store, which reads os.homedir() at import time. Without this the test
// would mint — and write — a real credential in the user's ~/.meowcode.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meow-webui-start-'))
process.env.HOME = TMP_HOME
process.env.USERPROFILE = TMP_HOME

const { startWebUI } = await import('./server')
const { loadWebUIToken } = await import('./token-store')
import type { WebUIServerInstance } from './types'

const BASE_PORT = 44681

/**
 * What a single `meowcode webui` actually does: binds a port, prints ONE
 * credential, and hands back an instance whose own URLs name that port.
 *
 * Both properties were wrong. The announcement used to fire once per bind
 * attempt — so two busy ports printed the token twice, the second time with a
 * stale port — and a retry that called server.listen directly never updated the
 * recorded port, so instance.url / baseUrl / port all kept naming the port that
 * was already taken. The user's symptom was a launch that printed a token for
 * 4040 and then another for 4041.
 */
describe('startWebUI: one announcement, one port, one token', () => {
  const servers: WebUIServerInstance[] = []
  let out = ''
  let realWrite: typeof process.stdout.write

  beforeAll(() => {
    realWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: any) => {
      out += String(chunk)
      return true
    }) as typeof process.stdout.write
  })

  afterAll(async () => {
    process.stdout.write = realWrite
    for (const s of servers) await s.close().catch(() => {})
    try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
  })

  afterEach(() => { out = '' })

  const tokenLines = (): string[] => out.split('\n').filter((l) => l.includes('WebUI token'))

  it('keeps the same token across restarts, so a saved URL keeps working', async () => {
    // The report: 「单次启动就固定token，不要网页一关就刷新token」.
    const a = await startWebUI({ port: BASE_PORT, host: '127.0.0.1', openBrowser: false })
    servers.push(a)
    const first = a.token

    const b = await startWebUI({ port: BASE_PORT + 1, host: '127.0.0.1', openBrowser: false })
    servers.push(b)

    expect(b.token).toBe(first)
    expect(loadWebUIToken()).toBe(first)
    // And it is the credential actually in force, not just a stored string.
    const res = await fetch(`http://127.0.0.1:${b.port}/api/session/state`, {
      headers: { 'X-MeowCode-Token': first },
    })
    expect(res.status).toBe(200)
  })

  it('prints the credential exactly once, on the port it really bound', async () => {
    // Occupy the port first so the walk-up fallback runs.
    const hog = net.createServer((c) => c.end())
    await new Promise<void>((r) => hog.listen(BASE_PORT + 2, '127.0.0.1', () => r()))
    try {
      const inst = await startWebUI({ port: BASE_PORT + 2, host: '127.0.0.1', openBrowser: false })
      servers.push(inst)

      expect(inst.port).toBe(BASE_PORT + 3)
      expect(inst.baseUrl).toBe(`http://127.0.0.1:${BASE_PORT + 3}`)
      expect(inst.url).toBe(`http://127.0.0.1:${BASE_PORT + 3}/#token=${inst.token}`)
      // Every announced URL has to name the live port, or the user authenticates
      // against a server that was never started.
      expect(tokenLines()).toEqual([
        `🔑 WebUI token (this URL is the only credential; treat it like a password): http://127.0.0.1:${BASE_PORT + 3}/#token=${inst.token}`,
      ])
      expect(out).toContain('is in use')
    } finally {
      await new Promise<void>((r) => hog.close(() => r()))
    }
  })

  it('announces --no-auth once, with no credential to hand out', async () => {
    const inst = await startWebUI({ port: BASE_PORT + 4, host: '127.0.0.1', openBrowser: false, auth: false })
    servers.push(inst)
    expect(inst.token).toBe('')
    expect(inst.url).toBe(`http://127.0.0.1:${BASE_PORT + 4}`)
    expect(tokenLines()).toHaveLength(0)
    expect(out.split('\n').filter((l) => l.includes('Auth bypassed'))).toHaveLength(1)
  })

  it('never mints or stores a credential under --no-auth', async () => {
    // Opting out of auth must not quietly write the user's real token file.
    const before = loadWebUIToken()
    const inst = await startWebUI({ port: BASE_PORT + 5, host: '127.0.0.1', openBrowser: false, auth: false })
    servers.push(inst)
    expect(loadWebUIToken()).toBe(before)
  })
})