// Legacy config-directory migration — MeowCode used to be called "AnyCode", and
// every piece of user state lived in ~/.anycode/. The product is now MeowCode
// everywhere (see lib/configDir.ts for the single source of truth: ~/.meowcode),
// so ~/.anycode is a dead directory that this build no longer reads.
//
// Rather than silently ignoring a user's history — or worse, silently MOVING it
// — startup detects the old directory and asks. On consent it copies the old
// contents into the new one without ever deleting the source: a botched copy is
// recoverable, and ~/.anycode stays on disk as a backup the user can remove (or
// re-merge from) themselves once they have checked the result.
//
// Design notes:
//   - Detection is "the old dir exists AND the new dir has nothing to merge":
//     once ~/.meowcode holds any of the known state files the prompt stops, so
//     this can never nag a user who already migrated (or never had the old dir).
//   - Non-TTY runs (print mode, pipes, CI) can't be prompted, so they print a
//     one-line notice and move on — the old dir keeps working as a manual backup.
//   - The question is asked from an Ink dialog (components/LegacyDirDialog.tsx)
//     mounted by cli.tsx before the TUI. An earlier version drew the prompt with
//     readline straight onto stderr; nothing owned the screen then, so the
//     terminal's own redraw cut the text in half mid-sentence. The dialog also
//     buys us the mouse and i18n the rest of the UI has.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { CONFIG_DIR } from './configDir'
import { t } from './i18n'

// The dialog's answer, kept here (rather than in the component) so this module
// stays the single vocabulary for the migration and the component imports it
// instead of the other way round — no import cycle.
export type LegacyChoice = 'merge' | 'skip'

export const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.anycode')
// Re-exported so tests (and any consumer) can name the destination without
// importing configDir directly.
export { CONFIG_DIR }

// Marker written after a successful merge. A plain file (not a flag inside
// settings.json) so it survives a settings reset and is trivial to inspect.
const MIGRATED_MARKER = '.migrated-from-anycode'

// The user-facing state files we know how to merge. `settings.json` is listed
// first because it is the file whose presence means "this is a real config",
// and everything else is optional. A file absent in the old dir is skipped; a
// file already present in the new dir is never overwritten (see mergeFile).
const MERGEABLE_FILES = [
  'settings.json',
  'entry.json',
  'credentials.json',
  'history.json',
  'memory.json',
  'stats.json',
  'model-windows.json',
  'update-check.json',
] as const

// Directories copied recursively when absent on the destination side.
const MERGEABLE_DIRS = ['sessions', 'memory', 'projects', 'mailbox', 'skills', 'commands', 'agents', 'entries', 'feedback'] as const

// Runtime state that belongs to a RUNNING process rather than to the user, so
// there is nothing to carry over: `ipc/` holds one dead Unix socket per past
// session (copyFileSync on a socket fails with ENXIO — it has no filesystem node
// to copy — and a live one would land as a dangling endpoint nobody can connect
// to) and `ide/` is IDE lock files rewritten on every launch. Both are recreated
// on demand, so ~/.meowcode simply starts without them.
const TRANSIENT_DIRS = new Set(['ipc', 'ide'])

// Skip node_modules and dotfiles inside content trees — a vendored dependency
// tree or a .DS_Store is not user state, and copying it wastes the user's time.
const SKIP_ENTRIES = new Set(['node_modules', '.DS_Store', '.git'])

export interface LegacyDirInfo {
  dir: string
  // Top-level names that exist in the old dir (files + dirs), for the prompt.
  present: string[]
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

function exists(p: string): boolean {
  try { fs.statSync(p); return true } catch { return false }
}

export function legacyDirExists(): boolean {
  return isDir(LEGACY_CONFIG_DIR)
}

// True when ~/.meowcode already carries anything worth protecting — either the
// user migrated before, or they never used the old name and built a fresh one.
// Either way we must not prompt again.
export function alreadyMigrated(): boolean {
  if (exists(path.join(CONFIG_DIR, MIGRATED_MARKER))) return true
  // A non-empty new dir means the user has real MeowCode state; the legacy dir
  // is then just an old backup they may want to keep, not something to merge.
  try {
    return fs.readdirSync(CONFIG_DIR).length > 0
  } catch {
    return false // no new dir at all → nothing to protect, prompt is safe
  }
}

// The legacy dir exists, is worth mentioning, and ~/.meowcode is empty — i.e.
// this build would otherwise silently start the user off with an empty history.
export function shouldOfferMigration(): boolean {
  return legacyDirExists() && !alreadyMigrated()
}

export function inspectLegacyDir(): LegacyDirInfo | null {
  if (!shouldOfferMigration()) return null
  let names: string[]
  try {
    names = fs.readdirSync(LEGACY_CONFIG_DIR)
  } catch {
    return null
  }
  const present = names.filter((n) => !SKIP_ENTRIES.has(n)).sort()
  return { dir: LEGACY_CONFIG_DIR, present }
}

function copyFileNoOverwrite(from: string, to: string): boolean {
  if (exists(to)) return false // never clobber newer MeowCode state
  try {
    // Only regular files have contents to copy: a socket, fifo or device node
    // throws (ENXIO/EINVAL) or would hang, and a broken symlink has no target.
    if (!fs.lstatSync(from).isFile()) return false
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    return true
  } catch {
    // One unreadable file must not abort the whole migration — the marker is
    // stamped only after every copy, so a throw here would leave us unmarked
    // and nag the user on every start. Skipping is the safe loss: the old dir
    // keeps the original, and the run still reports what did land.
    return false
  }
}

function copyTreeNoOverwrite(src: string, dst: string): number {
  fs.mkdirSync(dst, { recursive: true })
  let n = 0
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(e.name) || TRANSIENT_DIRS.has(e.name)) continue
    const from = path.join(src, e.name)
    const to = path.join(dst, e.name)
    // Anything that isn't a dir or a regular file (a stale session socket, a
    // fifo, a symlink) has no contents to carry — leave it in the old dir.
    if (e.isDirectory()) n += copyTreeNoOverwrite(from, to)
    else if (e.isFile() && copyFileNoOverwrite(from, to)) n++
  }
  return n
}

export interface MergeResult {
  files: number
  dirs: number
  skipped: number // present in both places; the old copy was left alone
}

// Copy the legacy state into ~/.meowcode. Additive only: nothing is deleted from
// the old dir, and any destination file that already exists is kept as-is (so
// re-running after a partial merge tops up what is missing instead of reverting
// what landed).
export function mergeLegacyDir(): MergeResult {
  const res: MergeResult = { files: 0, dirs: 0, skipped: 0 }
  if (!isDir(LEGACY_CONFIG_DIR)) return res
  fs.mkdirSync(CONFIG_DIR, { recursive: true })

  for (const f of MERGEABLE_FILES) {
    const from = path.join(LEGACY_CONFIG_DIR, f)
    if (!exists(from)) continue
    if (exists(path.join(CONFIG_DIR, f))) { res.skipped++; continue }
    if (copyFileNoOverwrite(from, path.join(CONFIG_DIR, f))) res.files++
  }
  for (const d of MERGEABLE_DIRS) {
    const from = path.join(LEGACY_CONFIG_DIR, d)
    if (!isDir(from)) continue
    res.files += copyTreeNoOverwrite(from, path.join(CONFIG_DIR, d))
    res.dirs++
  }
  // Stamp the marker last: if the copy threw midway we stay unmarked and get
  // asked again, and the no-overwrite rules make the retry idempotent anyway.
  try { fs.writeFileSync(path.join(CONFIG_DIR, MIGRATED_MARKER), `${LEGACY_CONFIG_DIR}\n`) } catch { /* best-effort */ }
  return res
}

export interface MigrationOutcome {
  offered: boolean
  merged: boolean
  result?: MergeResult
  info?: LegacyDirInfo
}

// Print the merge result on the normal screen (the dialog's alternate buffer is
// already torn down). Localized through the same catalog the dialog uses, so
// the module-level `t()` mirror matches the language the user answered in —
// cli.tsx calls setLang() from the config it read for the dialog.
export function reportMergeOutcome(outcome: MigrationOutcome): void {
  if (!outcome.merged || !outcome.result) return
  const { files, dirs, skipped } = outcome.result
  process.stdout.write(t('legacy.merged', { files, dirs }) + '\n')
  if (skipped) process.stdout.write(t('legacy.kept', { n: skipped }) + '\n')
}

// Ask the migration question. The caller (cli.tsx) owns the UI: it decides
// whether a TTY dialog is possible and hands us the answer. Splitting it this
// way keeps this module DOM/Ink-free so the unit tests can drive it directly.
// Returns quietly when there is nothing to say (no legacy dir, or already
// migrated) so the common case costs a single stat() per dir.
export async function offerLegacyMigration(ask: (info: LegacyDirInfo) => Promise<LegacyChoice>): Promise<MigrationOutcome> {
  const info = inspectLegacyDir()
  if (!info) return { offered: false, merged: false }
  if (process.stdin.isTTY) {
    const choice = await ask(info)
    if (choice === 'merge') {
      const result = mergeLegacyDir()
      return { offered: true, merged: true, result, info }
    }
    return { offered: true, merged: false, info }
  }
  // Can't ask (print mode / pipe / CI): say it once on stderr so the user learns
  // the old dir is no longer read, and start normally.
  process.stderr.write(t('legacy.notice', { old: LEGACY_CONFIG_DIR }) + '\n')
  process.stderr.write(t('legacy.noticeHint', { old: LEGACY_CONFIG_DIR, new: CONFIG_DIR }) + '\n')
  return { offered: false, merged: false, info }
}