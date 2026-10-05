import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { readLauncherConfig, runLauncher, type LauncherConfig } from './launcher'
import type { AppConfig, Message } from '../types'

describe('readLauncherConfig', () => {
  const ENTRY = path.join(HOME, 'manifest-entry')
  const write = (launcher: unknown): void => {
    fs.mkdirSync(ENTRY, { recursive: true })
    fs.writeFileSync(path.join(ENTRY, 'entry.json'), JSON.stringify({ name: 'x', launcher }))
  }

  it('anchors the files the entry ships and leaves everything else alone', () => {
    fs.mkdirSync(ENTRY, { recursive: true })
    fs.writeFileSync(path.join(ENTRY, 'launcher.mjs'), '//')
    fs.writeFileSync(path.join(ENTRY, 'webui.js'), '//')
    // Deliberately NOT created: the argument names a file, but not one beside the
    // entry, so it is the launched program's business, not ours.
    fs.rmSync(path.join(ENTRY, 'stray.txt'), { force: true })

    write({ command: 'node', args: ['launcher.mjs', 'webui.js', 'stray.txt', '--flag'], cwd: '.' })
    const cfg = readLauncherConfig(ENTRY)!

    // `node` stays a PATH lookup. Anchoring it would spawn `<entry>/node`.
    expect(cfg.command).toBe('node')
    expect(cfg.args?.slice(0, 2)).toEqual([
      path.join(ENTRY, 'launcher.mjs'),
      path.join(ENTRY, 'webui.js'),
    ])
    // Presence in the entry dir is the whole test, so an argument the entry does
    // not ship is left exactly as written — it resolves against the cwd, as it
    // did before this rule existed. `--flag` is certainly not a file.
    expect(cfg.args?.slice(2)).toEqual(['stray.txt', '--flag'])
    // The relative cwd is written through untouched: spawn resolves it against
    // the parent's cwd, which is the session directory, and that is the whole
    // point of declaring `"cwd": "."`.
    expect(cfg.cwd).toBe('.')
  })

  it('falls back to the entry dir, and returns null without a usable launcher', () => {
    write({ command: 'node', args: ['launcher.mjs'] })
    expect(readLauncherConfig(ENTRY)?.cwd).toBe(ENTRY)

    write({ args: ['launcher.mjs'] })
    expect(readLauncherConfig(ENTRY)).toBeNull()
    write({ command: 'node', args: 'not-an-array' })
    expect(readLauncherConfig(ENTRY)?.args).toEqual([])

    fs.writeFileSync(path.join(ENTRY, 'entry.json'), 'not json')
    expect(readLauncherConfig(ENTRY)).toBeNull()
  })
})

// A launcher entry is the one front-end MeowCode cannot unit-test any other way:
// the whole contract is bytes on a pipe between two processes. So the bridge tests
// below run the REAL bridge against a real child — a fixture plugin speaking the
// same newline-delimited JSON-RPC a shipped plugin does — and drive it from this
// side over a unix socket, which is the fixture's stand-in for a UI.
//
// Only homedir() is faked, so saveSession / memory / settings land in a temp dir
// and never touch the developer's ~/.meowcode. configDir.ts derives CONFIG_DIR
// from os.homedir() at import time, so mocking ../config would never reach it —
// same trick as entries.test.ts.
const { HOME, WORK, SOCK, NOTIFY } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-launcher-'))
  const work = path.join(home, 'work')
  fs.mkdirSync(work, { recursive: true })
  return { HOME: home, WORK: work, SOCK: path.join(home, 'plugin.sock'), NOTIFY: path.join(home, 'notify.log') }
})
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const mocked = { ...actual, homedir: () => HOME } as Omit<typeof actual, 'default'> & { default?: unknown }
  mocked.default = mocked // configDir.ts does `import os from 'node:os'`
  return mocked
})

// The fixture plugin, in three jobs and nothing else: answer the host's
// handshake, log every agent/event notification to a file the test reads, and
// serve a unix socket on which the test issues plugin→host requests.
//
// Pipe directions, which are the easy thing to get backwards: host→plugin lines
// arrive on our STDIN (that is what the host writes into), and plugin→host lines
// — our replies, our own requests, the host's replies to those — all go to our
// STDOUT. Note the host numbers its own requests from 1 and this file numbers its
// own from 10000, and the relay maps between the two id spaces: the test only
// ever knows the ids it handed out on the socket.
//
// `quit` makes the fixture exit 0, so runLauncher returns normally instead of
// taking the SIGTERM path (a signalled child resolves as code 1, and the bridge
// then calls process.exit).
const FIXTURE = `
const fs = require('node:fs'), readline = require('node:readline'), net = require('node:net')
const [sockPath, notifyPath] = process.argv.slice(2)
let nextId = 10000
let waiters = []
const toHost = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') {
    toHost({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, name: 'fixture', version: '0.0.0' } })
  } else if (msg.method === 'agent/event') {
    fs.appendFileSync(notifyPath, JSON.stringify(msg.params) + '\\n')
  } else if (typeof msg.id === 'number') {
    const w = waiters.find((x) => x.id === msg.id)
    if (w) { waiters = waiters.filter((x) => x !== w); w.sock.write(JSON.stringify({ id: w.testId, error: msg.error, result: msg.result }) + '\\n') }
  }
})

const srv = net.createServer((sock) => {
  readline.createInterface({ input: sock }).on('line', (line) => {
    const req = JSON.parse(line)
    if (req.method === 'quit') { srv.close(); sock.end(); setTimeout(() => process.exit(0), 20); return }
    const id = nextId++
    waiters.push({ id, testId: req.id, sock })
    toHost({ jsonrpc: '2.0', id, method: req.method, params: req.params ?? {} })
  })
})
srv.listen(sockPath)
`

// ---- the test-side plugin client --------------------------------------------

class Plugin {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private buf = ''

  constructor(private readonly sock: net.Socket) {
    sock.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString('utf8')
      let i = this.buf.indexOf('\n')
      while (i >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        i = this.buf.indexOf('\n')
        if (!line) continue
        const msg = JSON.parse(line)
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      }
    })
  }

  call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<any> {
    const id = this.nextId++
    const done = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
    this.sock.write(JSON.stringify({ id, method, params }) + '\n')
    return done
  }

  /** Every agent/event the host pushed, as the fixture logged it. */
  events(): Array<{ turn: number; event: any }> {
    if (!fs.existsSync(NOTIFY)) return []
    return fs.readFileSync(NOTIFY, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  }

  /** Wait until some agent/event of `type` has been pushed since index `from`. */
  async waitForEvent(type: string, from = 0, timeoutMs = 20_000): Promise<number> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const events = this.events()
      const i = events.findIndex((e, idx) => idx >= from && e.event.type === type)
      if (i >= 0) return i
      if (Date.now() > deadline) throw new Error(`no ${type} event within ${timeoutMs}ms`)
      await new Promise((r) => setTimeout(r, 25))
    }
  }

  messages(): Promise<Message[]> {
    return this.call('session/state').then((s) => s.messages as Message[])
  }
}

const CONFIG: AppConfig = { provider: 'mock', model: 'mock-model', settings: {} }

let plugin: Plugin
let exited: Promise<number>

/** Connect once the fixture is listening — the socket file appears before the listen completes. */
function connectWhenReady(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20_000
    const tryOnce = (): void => {
      const sock = net.connect(SOCK)
      sock.once('connect', () => resolve(sock))
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > deadline) reject(new Error('the fixture plugin never listened on its socket'))
        else setTimeout(tryOnce, 100)
      })
    }
    tryOnce()
  })
}

beforeAll(async () => {
  const fixture = path.join(HOME, 'fixture-plugin.cjs')
  fs.writeFileSync(fixture, FIXTURE)
  fs.writeFileSync(NOTIFY, '')
  exited = runLauncher({ command: process.execPath, args: [fixture, SOCK, NOTIFY], cwd: WORK }, CONFIG)
  plugin = new Plugin(await connectWhenReady())
  // Round-trip once before the tests start, so the handshake has demonstrably
  // completed — the ordering every real front-end depends on.
  await plugin.call('session/state')
}, 60_000)

afterAll(async () => {
  try {
    await plugin.call('quit', {}, 5_000)
    await exited
  } catch {
    // The child is gone either way; a failure here must not mask the tests.
  }
}, 30_000)

describe('launcher bridge (real child process)', () => {
  it('completes the handshake and answers the read-only methods', async () => {
    const cfg = await plugin.call('config/get')
    expect(cfg.provider).toBe('mock')
    // The API key is env-sourced and must never cross the bridge.
    expect('apiKey' in cfg).toBe(false)

    const { tools } = await plugin.call('tools/list')
    expect(tools.map((t: any) => t.name)).toContain('read_file')

    const state = await plugin.call('session/state')
    expect(typeof state.sessionId).toBe('string')
    expect(state.usage).toMatchObject({ turns: 0, toolCalls: 0 })
  }, 30_000)

  it('rejects an empty prompt, a second concurrent turn, and unknown methods', async () => {
    await expect(plugin.call('agent/turn', { prompt: '   ' })).rejects.toThrow(/non-empty prompt/)
    await expect(plugin.call('agent/nope')).rejects.toThrow(/unknown method/)

    const from = plugin.events().length
    const first = plugin.call('agent/turn', { prompt: 'tell me a story' })
    await plugin.waitForEvent('text', from)
    await expect(plugin.call('agent/turn', { prompt: 'and again' })).rejects.toThrow(/already streaming/)

    await plugin.call('agent/abort')
    await first
  }, 60_000)

  it('aborts a running turn: partial answer committed as interrupted, no error row', async () => {
    const from = plugin.events().length
    const before = (await plugin.call('session/state')).messages.length
    const turn = plugin.call('agent/turn', { prompt: 'tell me a longer story' })
    await plugin.waitForEvent('text', from)

    await expect(plugin.call('agent/abort')).resolves.toEqual({ aborted: true })
    // The turn resolves normally rather than rejecting — a plugin needs no
    // abort event to learn that it is over.
    await expect(turn).resolves.toMatchObject({ turn: expect.any(Number) })

    const msgs = await plugin.messages()
    expect(msgs.length).toBeGreaterThan(before)
    expect(msgs[before]).toMatchObject({ role: 'user', content: 'tell me a longer story' })
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.meta?.interrupted).toBe(true)
    // Something streamed before the abort landed, so the row is not empty…
    expect(last.content.length).toBeGreaterThan(0)
    // …but it stops short of the model's full reply: that is the abort biting.
    expect(last.content).not.toContain('ANTHROPIC_API_KEY')
    // Interrupting is not failing: no ⚠ row anywhere.
    expect(msgs.some((m) => m.meta?.error)).toBe(false)

    // The one-turn-at-a-time guard is released, so the session still works.
    const from2 = plugin.events().length
    const next = plugin.call('agent/turn', { prompt: 'still there?' })
    await plugin.waitForEvent('text', from2)
    await plugin.call('agent/abort')
    await expect(next).resolves.toMatchObject({ turn: expect.any(Number) })
  }, 90_000)

  it('still commits a row when the abort beats the first token', async () => {
    // `retry:` announces itself with a retry event and then sleeps 500ms before
    // any text, so aborting on that event lands squarely in the window useChat
    // handles the same way: nothing streamed, yet the turn must leave a row
    // saying it was interrupted.
    //
    // Waiting for the event also dodges a real ordering property: the bridge
    // reads lines one at a time, so an abort sent before agent/turn has even
    // installed its controller finds nothing to stop and answers aborted:false.
    const from = plugin.events().length
    const before = (await plugin.call('session/state')).messages.length
    const turn = plugin.call('agent/turn', { prompt: 'retry: never mind' })
    await plugin.waitForEvent('retry', from)
    await expect(plugin.call('agent/abort')).resolves.toEqual({ aborted: true })
    await turn
    const msgs = await plugin.messages()
    expect(msgs[before]).toMatchObject({ role: 'user', content: 'retry: never mind' })
    expect(msgs[before + 1]).toMatchObject({ role: 'assistant', content: '', meta: { interrupted: true } })
  }, 60_000)

  it('reports aborted:false when nothing is running instead of throwing', async () => {
    // A stop button pressed after the turn already ended must not blow up.
    await expect(plugin.call('agent/abort')).resolves.toEqual({ aborted: false })
    await expect(plugin.call('agent/abort')).resolves.toEqual({ aborted: false })
  }, 30_000)

  it('streams tool calls into the transcript as TUI-shaped rows', async () => {
    fs.writeFileSync(path.join(WORK, 'probe.txt'), 'hello from the fixture test\n')
    const from = plugin.events().length
    const before = (await plugin.call('session/state')).messages.length
    await plugin.call('agent/turn', { prompt: `ls: ${WORK}` })
    const fresh = (await plugin.messages()).slice(before)
    const callRow = fresh.find((m) => m.role === 'tool' && m.content.startsWith('● '))
    const resultRow = fresh.find((m) => m.role === 'tool' && m.content.startsWith('⎿ '))
    expect(callRow?.content).toMatch(/^● list_dir · /)
    // The tool really ran, so its output is behind the truncation marker.
    expect(resultRow?.content).toContain('probe.txt')
    // And the same call/result pair went out as notifications, in order.
    const pushed = plugin.events().slice(from).map((e) => e.event.type)
    expect(pushed).toContain('tool_use')
    expect(pushed.indexOf('tool_use')).toBeLessThan(pushed.lastIndexOf('tool_result'))
  }, 60_000)

  it('runs a tool through tools/call', async () => {
    const r = await plugin.call('tools/call', { name: 'read_file', input: { path: path.join(WORK, 'probe.txt') } })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('hello from the fixture test')
  }, 30_000)

  it('clears the transcript on session/reset, and a fresh turn starts from nothing', async () => {
    await plugin.call('agent/turn', { prompt: 'hi' })
    const before = await plugin.call('session/state')
    expect(before.messages.length).toBeGreaterThan(0)
    const cleared = await plugin.call('session/reset')
    const after = await plugin.call('session/state')
    expect(after.messages).toEqual([])
    expect(after.usage).toMatchObject({ turns: 0, toolCalls: 0 })
    expect(cleared.sessionId).not.toBe(before.sessionId)
    await expect(plugin.call('agent/turn', { prompt: 'after the reset' })).resolves.toBeTruthy()
  }, 90_000)

  it('persists the transcript under the fake home, /resume-compatible', async () => {
    const { sessionId } = await plugin.call('session/state')
    // The host owns the transcript, so it lands in sessions/ exactly like a TUI
    // session does — that is what makes a launcher entry resumable. The autosave
    // is debounced, so wait for the file to show up and then for the last turn to
    // have made it in (a file from an earlier save would be a stale read).
    const file = path.join(HOME, '.meowcode', 'sessions', `${sessionId}.json`)
    await vi.waitFor(() => {
      expect(fs.existsSync(file)).toBe(true)
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
      expect(rec.snapshot.messages.some((m: Message) => m.content === 'after the reset')).toBe(true)
      expect(rec.snapshot.usage.turns).toBeGreaterThan(0)
      // And the config stored alongside never carries a key.
      expect('apiKey' in rec.snapshot.config).toBe(false)
    }, { timeout: 15_000 })
  }, 30_000)
})

// A launcher that dies during startup is the failure this suite could not see for
// the longest, because it looks exactly like a slow one: the child's exit resolves
// in tens of milliseconds, but nothing was waiting on that promise — the handshake
// was, and it waits out REQUEST_TIMEOUT_MS because the write into a dead child's
// stdin reports no error. So the host sits in epoll for ten minutes with the
// launcher's own error already printed above it.
//
// The budget here is deliberately far above the ~100ms this actually takes: a test
// that fails only on a loaded CI box is a test nobody trusts.
describe('a launcher that exits before the handshake', () => {
  /**
   * `runLauncher` ends a failed launch with `process.exit`, by design: the CLI's
   * contract is that the host's exit code IS the launcher's. So the observation has
   * to be made at that seam rather than from the return value, which is only
   * reachable when the launcher succeeded.
   */
  async function runAndCaptureExit(cfg: LauncherConfig): Promise<{ code: number; ms: number }> {
    const real = process.exit
    let seen: number | null = null
    process.exit = ((code?: number) => { seen = code ?? 0 }) as never
    const started = Date.now()
    try {
      await runLauncher(cfg, CONFIG)
    } finally {
      process.exit = real
    }
    return { code: seen ?? 0, ms: Date.now() - started }
  }

  it('gives up on the handshake and exits with a failure, in milliseconds', async () => {
    const dead = path.join(HOME, 'dead-launcher.cjs')
    fs.writeFileSync(dead, 'process.exit(3)\n')
    const { code, ms } = await runAndCaptureExit({ command: process.execPath, args: [dead], cwd: WORK })
    expect(code).not.toBe(0)
    expect(ms).toBeLessThan(30_000)
  }, 60_000)

  it('survives a command that does not exist at all', async () => {
    // 'error' rather than 'exit' — spawn fails asynchronously, so this is the other
    // half of the same hang and the same fix.
    const { code, ms } = await runAndCaptureExit({ command: path.join(HOME, 'no-such-binary'), cwd: WORK })
    expect(code).not.toBe(0)
    expect(ms).toBeLessThan(30_000)
  }, 60_000)
})
