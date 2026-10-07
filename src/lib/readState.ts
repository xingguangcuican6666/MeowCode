// Read-before-write bookkeeping, mirroring Claude Code: `edit_file` / `write_file`
// refuse to touch an EXISTING file the model has not read in this session, or one
// that changed on disk since it was read (a formatter, the user's editor, another
// command). Without it the model can clobber a file it never looked at, or edit
// against stale contents and silently revert someone else's change.
//
// Module-level and in-memory, like lib/checkpoints: the tool loop and /clear share
// the one process. Keyed by the absolute path the tool resolved.
import fs from 'node:fs'

const seen = new Map<string, number>() // absolute path → mtimeMs when last read/written by a tool

/** Record that `file` was just read (or written) by a tool at this mtime. */
export function noteRead(file: string, mtimeMs: number): void {
  seen.set(file, mtimeMs)
}

/** Record the file's CURRENT on-disk state (call right after a tool wrote it). */
export function noteFileState(file: string): void {
  try { seen.set(file, fs.statSync(file).mtimeMs) } catch { /* vanished — nothing to track */ }
}

/**
 * Why the model may not modify `file` right now, or null when it may. A file that
 * does not exist yet is always fine (that is a create, not an overwrite).
 */
export function staleReason(file: string): string | null {
  let mtime: number
  try { mtime = fs.statSync(file).mtimeMs } catch { return null }
  const at = seen.get(file)
  if (at === undefined) return 'the file has not been read yet — read it with read_file first, then retry.'
  if (mtime !== at) return 'the file changed on disk since you read it (the user, a formatter or another command touched it) — read it again, then retry.'
  return null
}

/** Forget everything (a brand-new session via /clear). */
export function clearReadState(): void {
  seen.clear()
}
