// Shared plumbing for running command lines. Every place MeowCode executes a
// model- or config-supplied shell string (the foreground `bash` tool, background
// shells, monitors, hooks, the status line) and every place it runs a helper
// binary with model-supplied arguments (grep/rg) goes through here, so they all
// get the same guarantees:
//
//   - The child leads its own process group. A timeout, an abort or MeowCode's own
//     exit kills the WHOLE tree. A plain `child.kill()` only reaches the shell and
//     leaves its children running — and holding the stdout pipe open, which also
//     made the tool hang past its own timeout.
//   - Captured output is bounded (the head and the tail are kept), so `yes` or a
//     runaway build log cannot exhaust memory.
//   - stdin is /dev/null unless the caller pipes input, so a command that reads
//     stdin sees EOF instead of blocking until the timeout. (Being in its own
//     session it also has no controlling terminal, so `git`/`ssh` prompts fail
//     fast instead of scribbling over the TUI.)
//   - Every live child is killed when MeowCode exits, so nothing is orphaned.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import fs from 'node:fs'

const POSIX = process.platform !== 'win32'

let cachedShell: string | undefined
/** The shell that runs command lines: bash where it lives at a well-known path, else whatever `bash` resolves to on PATH (NixOS has no /bin/bash). */
export function shellBin(): string {
  if (cachedShell) return cachedShell
  for (const p of ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash']) {
    try { if (fs.existsSync(p)) return (cachedShell = p) } catch { /* keep looking */ }
  }
  return (cachedShell = 'bash')
}

// ---- child tracking ---------------------------------------------------------

const live = new Set<ChildProcess>()
let cleanupInstalled = false

function killAllLive(): void {
  for (const c of live) killTree(c, 'SIGKILL')
}

// A normal `process.exit()` fires 'exit'; a terminating signal does not, so the
// common ones are intercepted too (kill the children, then re-raise so the default
// disposition still ends the process — unless someone else owns the signal).
function installCleanup(): void {
  if (cleanupInstalled) return
  cleanupInstalled = true
  process.on('exit', killAllLive)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      killAllLive()
      if (process.listenerCount(sig) === 0) {
        try { process.kill(process.pid, sig) } catch { /* ignore */ }
      }
    })
  }
}

function track(child: ChildProcess): void {
  live.add(child)
  const drop = (): void => { live.delete(child) }
  child.once('close', drop)
  child.once('error', drop)
  installCleanup()
}

/** Signal a child's whole process group (it was spawned as a group leader). */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  const pid = child.pid
  if (!pid) return
  try {
    if (POSIX) process.kill(-pid, signal)
    else child.kill(signal)
  } catch {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}

// ---- spawning ---------------------------------------------------------------

export interface SpawnShellOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdio?: StdioOptions
}

/** Spawn `bash -c <command>` as a tracked process-group leader. stdin defaults to /dev/null. */
export function spawnShell(command: string, opts: SpawnShellOptions = {}): ChildProcess {
  return launch(shellBin(), ['-c', command], opts)
}

/** Spawn a binary directly (no shell, so arguments are never re-parsed). */
export function spawnFile(file: string, args: string[], opts: SpawnShellOptions = {}): ChildProcess {
  return launch(file, args, opts)
}

function launch(file: string, args: string[], opts: SpawnShellOptions): ChildProcess {
  const child = spawn(file, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    detached: POSIX,
  })
  track(child)
  return child
}

// ---- bounded capture --------------------------------------------------------

/** Keeps the first `headMax` and the last `tailMax` characters of a stream. */
class Capture {
  private head = ''
  private tail = ''
  private total = 0
  constructor(private readonly headMax: number, private readonly tailMax: number) {}

  push(chunk: string): void {
    this.total += chunk.length
    if (this.head.length < this.headMax) {
      const room = this.headMax - this.head.length
      this.head += chunk.slice(0, room)
      chunk = chunk.slice(room)
      if (!chunk) return
    }
    this.tail += chunk
    // Trim lazily (at 2x) so a flood of small chunks stays O(n).
    if (this.tail.length > this.tailMax * 2) this.tail = this.tail.slice(-this.tailMax)
  }

  text(): string {
    const tail = this.tail.length > this.tailMax ? this.tail.slice(-this.tailMax) : this.tail
    const omitted = this.total - this.head.length - tail.length
    return omitted > 0 ? `${this.head}\n… [${omitted} chars omitted] …\n${tail}` : this.head + tail
  }
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  /** Piped to stdin, then stdin is closed. Absent → stdin is /dev/null. */
  input?: string
  /** Characters kept from the start / end of each stream (defaults 120k / 120k). */
  headChars?: number
  tailChars?: number
}

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** Set when the process could not be started at all. */
  error?: string
}

const KILL_GRACE_MS = 1500   // SIGTERM → SIGKILL
const PIPE_GRACE_MS = 500    // after the shell exits, how long to wait for its pipes to drain

/** Run a command line to completion with bounded output; never rejects. */
export function runCaptured(command: string, opts: RunOptions = {}): Promise<RunResult> {
  return run(() => spawnShell(command, { cwd: opts.cwd, env: opts.env, stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'] }), opts)
}

/** Run a binary with an argv array (no shell) to completion with bounded output; never rejects. */
export function runFile(file: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run(() => spawnFile(file, args, { cwd: opts.cwd, env: opts.env, stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'] }), opts)
}

function run(start: () => ChildProcess, opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const headMax = opts.headChars ?? 120_000
    const tailMax = opts.tailChars ?? 120_000
    const out = new Capture(headMax, tailMax)
    const err = new Capture(headMax, tailMax)
    let timedOut = false
    let aborted = false
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined
    let graceTimer: NodeJS.Timeout | undefined

    let child: ChildProcess
    try {
      child = start()
    } catch (e) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false, error: (e as Error).message })
      return
    }

    const onAbort = (): void => { aborted = true; terminate() }
    const finish = (code: number | null, signal: NodeJS.Signals | null, error?: string): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (graceTimer) clearTimeout(graceTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, signal, stdout: out.text(), stderr: err.text(), timedOut, aborted, error })
    }
    function terminate(): void {
      if (child.exitCode !== null || settled) return
      killTree(child, 'SIGTERM')
      killTimer = setTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS)
      killTimer.unref()
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => out.push(d))
    child.stderr?.on('data', (d: string) => err.push(d))
    child.on('error', (e) => finish(null, null, e.message))
    child.on('exit', (code, signal) => {
      // The shell is gone, but a grandchild that inherited the pipes can keep
      // 'close' from ever firing — give the pipes a moment to drain, then cut them.
      graceTimer = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        finish(code, signal)
      }, PIPE_GRACE_MS)
    })
    child.on('close', (code, signal) => finish(code, signal))

    if (opts.timeoutMs && opts.timeoutMs > 0) timer = setTimeout(() => { timedOut = true; terminate() }, opts.timeoutMs)
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on('error', () => { /* the command may not read its stdin */ })
      child.stdin.end(opts.input)
    }
  })
}

/** Does a binary exist on PATH? Cached per name. */
const found = new Map<string, boolean>()
export function hasBinary(name: string): boolean {
  const hit = found.get(name)
  if (hit !== undefined) return hit
  let ok = false
  for (const dir of (process.env.PATH ?? '').split(POSIX ? ':' : ';')) {
    if (!dir) continue
    try { fs.accessSync(`${dir}/${name}`, fs.constants.X_OK); ok = true; break } catch { /* next */ }
  }
  found.set(name, ok)
  return ok
}
