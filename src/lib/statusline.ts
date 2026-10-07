// Custom status line (the `statusLine` setting): a user-provided shell command
// whose stdout becomes a persistent footer line, mirroring Claude Code's
// `statusLine`. The command receives a JSON context object on stdin (model,
// provider, cwd, version, session token/turn totals) and prints its status to
// stdout; we take the first non-empty line. Shelling out per render would be far
// too costly, so the caller runs this on a slow poll and caches the last line.
import { runCaptured } from './shell'

export interface StatusLineContext {
  model: string
  provider: string
  cwd: string
  version: string
  // Cumulative session totals, for a cost/context-style readout.
  tokens?: number
  turns?: number
}

const RUN_TIMEOUT_MS = 5_000

// Run the command and resolve to its first non-empty stdout line, or null if it
// failed, timed out, or printed nothing. Never rejects — a broken status-line
// command must not crash the app; it just yields no line.
export async function runStatusLine(command: string, ctx: StatusLineContext, signal?: AbortSignal): Promise<string | null> {
  const r = await runCaptured(command, {
    signal, timeoutMs: RUN_TIMEOUT_MS, input: JSON.stringify(ctx), headChars: 16_000, tailChars: 1_000,
  })
  if (r.error || r.timedOut || r.aborted) return null
  const line = r.stdout.split('\n').map((l) => l.trimEnd()).find((l) => l.trim().length > 0)
  return line ? line.trim() : null
}
