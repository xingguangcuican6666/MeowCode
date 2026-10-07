// Scope of an "always allow" decision taken in the permission dialog.
//
// The dialog's middle option used to add the TOOL to a session allow-list: say
// "always" once to `bash(npm test)` and every later `bash` — `rm -rf`, `curl | sh`
// — ran unprompted for the rest of the session. The grant now carries the shape of
// what was approved, so it covers the same KIND of call and nothing wider:
//
//   bash             → the command's leading words, e.g. `npm test …` → "npm test"
//   file tools       → the file's directory
//   web_fetch        → the URL's host
//   everything else  → the tool name (no natural narrower target)
//
// Pure string logic, deliberately separate from the Ink layer so it can be tested
// and so both the dialog label and the matcher derive from ONE definition.
import path from 'node:path'

export interface AllowScope {
  tool: string
  /** The narrowed target, or undefined when the grant is tool-wide. */
  value?: string
  kind: 'tool' | 'command' | 'dir' | 'host'
}

/** Shell metacharacters: a command containing any of these is never generalized. */
const SHELL_META = /[;&|<>$()`\n]/

/**
 * The leading command words to generalize over: the program plus a sub-command
 * when the program is one of the common multiplexers (`git status`, `npm run`,
 * `cargo build`). A command with shell metacharacters generalizes to nothing —
 * `npm test && rm -rf /` must not teach us to allow "npm test".
 */
const MULTIPLEXERS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'docker', 'kubectl', 'uv', 'pip', 'poetry', 'make', 'gh', 'dotnet', 'brew', 'apt', 'systemctl'])

function commandPrefix(command: string): string | undefined {
  const cmd = command.trim()
  if (!cmd || SHELL_META.test(cmd)) return undefined
  const words = cmd.split(/\s+/)
  const program = words[0]
  if (!program || program.startsWith('-')) return undefined
  // An absolute/relative path keeps only its basename for the label's sake.
  const name = program.includes('/') ? path.basename(program) : program
  if (MULTIPLEXERS.has(name) && words[1] && !words[1].startsWith('-')) return `${name} ${words[1]}`
  return name
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** What an "always allow" on this call should cover. */
export function scopeFor(tool: string, input: Record<string, unknown>): AllowScope {
  const i = input ?? {}
  if (tool === 'bash') {
    const prefix = commandPrefix(String(i.command ?? ''))
    return prefix ? { tool, value: prefix, kind: 'command' } : { tool, kind: 'tool' }
  }
  if (tool === 'write_file' || tool === 'edit_file' || tool === 'notebook_edit' || tool === 'read_file') {
    const p = firstString(i, ['path', 'file_path', 'notebook_path'])
    if (!p) return { tool, kind: 'tool' }
    const dir = path.dirname(path.resolve(p))
    return { tool, value: dir, kind: 'dir' }
  }
  if (tool === 'web_fetch') {
    const url = firstString(i, ['url'])
    if (url) {
      try { return { tool, value: new URL(url).host.toLowerCase(), kind: 'host' } } catch { /* fall through */ }
    }
    return { tool, kind: 'tool' }
  }
  return { tool, kind: 'tool' }
}

/** Stable key for storing a grant in a Set. */
export function scopeKey(s: AllowScope): string {
  return s.value === undefined ? `${s.tool}\u0000*` : `${s.tool}\u0000${s.kind}\u0000${s.value}`
}

/**
 * Does a previously granted scope cover this call? A tool-wide grant covers every
 * call to that tool; a `dir` grant also covers SUBdirectories (approving
 * `src/components` once shouldn't re-prompt for `src/components/ui`).
 */
export function scopeCovers(granted: AllowScope, tool: string, input: Record<string, unknown>): boolean {
  if (granted.tool !== tool) return false
  if (granted.value === undefined) return true
  const want = scopeFor(tool, input)
  if (want.value === undefined) return false            // can't be generalized → ask
  if (granted.kind !== want.kind) return false
  if (granted.kind === 'dir') {
    const rel = path.relative(granted.value, want.value)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
  return granted.value === want.value
}

/** A session's set of grants. */
export class AllowList {
  private readonly grants = new Map<string, AllowScope>()

  add(scope: AllowScope): void { this.grants.set(scopeKey(scope), scope) }

  covers(tool: string, input: Record<string, unknown>): boolean {
    for (const g of this.grants.values()) if (scopeCovers(g, tool, input)) return true
    return false
  }

  clear(): void { this.grants.clear() }
  get size(): number { return this.grants.size }
}

/** How the scope reads in the dialog's "always allow …" option. */
export function describeScope(s: AllowScope): string {
  if (s.value === undefined) return s.tool
  if (s.kind === 'command') return `${s.value} …`
  if (s.kind === 'dir') return `${s.tool} in ${s.value}`
  if (s.kind === 'host') return `${s.tool} ${s.value}`
  return s.tool
}
