// Project-config trust — the gate in front of code that a CHECKED-OUT REPOSITORY
// can ask MeowCode to run. A project's `.meowcode/settings.json` may define
// `hooks` (shell commands fired on lifecycle events) and `mcpServers` (processes
// spawned at startup). Honouring those the moment a directory is opened would
// mean that cloning a repository and starting MeowCode in it is enough to execute
// whatever its author wrote — no prompt, no tool call, nothing the user approved.
//
// So project-level `hooks`/`mcpServers` are IGNORED until the user trusts that
// directory (`/trust`). The user's own ~/.meowcode/settings.json is unaffected:
// that is their config, not the repository's. Nothing here is interactive, so the
// safe default also holds for launcher/CI/print runs.
//
// The trust list lives in ~/.meowcode/trust.json: resolved absolute paths, plus
// the mtime+size of the settings file as seen when trust was granted — so trust
// covers the content that was reviewed, and an edit (by a pull, by a teammate)
// re-arms the gate instead of riding on the old decision.
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR } from './configDir'

const TRUST_FILE = path.join(CONFIG_DIR, 'trust.json')

export interface TrustEntry {
  path: string          // resolved project directory
  grantedAt: number
  /** Fingerprint of .meowcode/settings.json when trust was granted. */
  mtimeMs?: number
  size?: number
}

interface TrustStore { version: 1; projects: TrustEntry[] }

function readStore(): TrustStore {
  try {
    const raw = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8')) as TrustStore
    if (raw && Array.isArray(raw.projects)) return { version: 1, projects: raw.projects.filter((p) => p && typeof p.path === 'string') }
  } catch { /* missing or corrupt → nothing is trusted */ }
  return { version: 1, projects: [] }
}

function writeStore(store: TrustStore): boolean {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(TRUST_FILE, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    return true
  } catch { return false }
}

/** Where a project's settings file lives. */
export function projectSettingsPath(cwd: string): string {
  return path.join(path.resolve(cwd), '.meowcode', 'settings.json')
}

function fingerprint(file: string): { mtimeMs?: number; size?: number } {
  try { const st = fs.statSync(file); return { mtimeMs: st.mtimeMs, size: st.size } } catch { return {} }
}

/** Does this project define hooks or MCP servers of its own? */
export function projectDefinesExecutables(cwd: string): { hooks: number; mcpServers: string[] } {
  const out = { hooks: 0, mcpServers: [] as string[] }
  try {
    const j = JSON.parse(fs.readFileSync(projectSettingsPath(cwd), 'utf8')) as Record<string, any>
    const hooks = j?.hooks
    if (hooks && typeof hooks === 'object') {
      for (const list of Object.values(hooks)) {
        if (!Array.isArray(list)) continue
        for (const m of list) out.hooks += Array.isArray(m?.hooks) ? m.hooks.length : 0
      }
    }
    const mcp = j?.mcpServers
    if (mcp && typeof mcp === 'object') out.mcpServers = Object.keys(mcp)
  } catch { /* no project settings → nothing to declare */ }
  return out
}

/**
 * May this project's own hooks/mcpServers run? True only when the user trusted
 * the directory AND the settings file still matches what they trusted.
 */
export function isProjectTrusted(cwd = process.cwd()): boolean {
  const dir = path.resolve(cwd)
  const entry = readStore().projects.find((p) => path.resolve(p.path) === dir)
  if (!entry) return false
  const fp = fingerprint(projectSettingsPath(dir))
  // Trust was recorded against a specific file state; a changed file must be
  // re-approved. (No file at all is fine — nothing can run.)
  if (entry.mtimeMs !== undefined && fp.mtimeMs !== undefined) {
    if (entry.mtimeMs !== fp.mtimeMs || entry.size !== fp.size) return false
  }
  return true
}

/** Record trust for a directory, pinned to its current settings file. */
export function trustProject(cwd = process.cwd()): boolean {
  const dir = path.resolve(cwd)
  const store = readStore()
  store.projects = store.projects.filter((p) => path.resolve(p.path) !== dir)
  store.projects.push({ path: dir, grantedAt: Date.now(), ...fingerprint(projectSettingsPath(dir)) })
  return writeStore(store)
}

/** Forget a directory's trust. Returns false when it wasn't trusted. */
export function untrustProject(cwd = process.cwd()): boolean {
  const dir = path.resolve(cwd)
  const store = readStore()
  const before = store.projects.length
  store.projects = store.projects.filter((p) => path.resolve(p.path) !== dir)
  if (store.projects.length === before) return false
  return writeStore(store)
}

export function listTrusted(): TrustEntry[] {
  return readStore().projects.slice().sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Does this directory have project-level executables waiting on a trust decision?
 * Drives the one-line startup notice that makes `/trust` discoverable — without it
 * the gate would be silent and a legitimate project's hooks would look broken.
 */
export function pendingTrust(cwd = process.cwd()): { hooks: number; mcpServers: string[] } | null {
  const found = projectDefinesExecutables(cwd)
  if (found.hooks === 0 && found.mcpServers.length === 0) return null
  return isProjectTrusted(cwd) ? null : found
}
