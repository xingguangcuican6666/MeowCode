// Entries — the front-ends and wiring meowcode can start under. An "entry" is a
// self-contained directory under ~/.meowcode/entries/<name>/ holding its own
// config overrides (entry.json), persisted full config (settings.json — written
// by saveConfig while the entry is active) and content dirs (skills/, commands/,
// agents/), optionally a `launcher` that replaces the whole UI (see
// lib/launcher). ~/.meowcode/entry.json names the default entry activated at
// startup (overridable with --entry <name>); with no default we start the
// built-in `tui` entry.
//
// An entry is NOT a user profile: it is a completely separate UI + wiring
// (think "the same agent, driven through a different front-end"), not a
// per-person slice of config. The built-in terminal UI is itself an entry, named
// `tui`, materialized on first startup. Conversation state — sessions/, memory/
// (incl. projects/) and history.json — is SHARED across all entries and lives at
// the CONFIG_DIR root; see stateDir below.
//
// Config layering (lowest → highest precedence):
//   hardcoded defaults → global ~/.meowcode/settings.json → entry settings.json
//   → entry.json overrides. The settings bag merges key-by-key at each layer.
// The API key is always env-sourced and never read from (or written to) entry
// files.
import path from 'node:path'
import fs from 'node:fs'
// CONFIG_DIR comes from lib/configDir (not ../config) so this module never
// shares an initialization order with config.ts: config.ts's loadConfig calls
// back into applyEntryOverrides below (config → entries cycle), and a const
// read at module scope there would be a TDZ hazard. saveConfig is only called
// inside function bodies, which live bindings make safe.
import { CONFIG_DIR } from './configDir'
import { saveConfig } from '../config'
import type { AppConfig } from '../types'

export const ENTRIES_DIR = path.join(CONFIG_DIR, 'entries')
// Re-exported for tests and any consumer that wants the effective config dir
// without picking a side in the config↔entries cycle.
export { CONFIG_DIR }

// The built-in terminal UI, as an ordinary entry. Materialized on first startup
// so it lists, can be made the default, and can even get its own settings.json —
// but it is never created, removed or overwritten by the user-facing commands.
export const BUILTIN_ENTRY = 'tui'

export interface EntryMeta {
  name: string
  description?: string
  // True when the entry's entry.json declares a "launcher" front-end (a
  // has-entry plugin: webui, tray app, …). List surfaces (`/entry`, `meowcode
  // entry list`) show a [launcher] mark for these so "replaces the whole UI" is
  // visible before you enter one.
  hasLauncher: boolean
  // The built-in terminal UI. Marked so it reads as the one entry you can't
  // delete or recreate.
  builtin: boolean
  dir: string
}

// Entry names double as directory names, so reject anything that could escape
// ENTRIES_DIR or collide with tooling (an entry dir is code-shaped: a launcher
// command, skills, MCP servers — a name with a slash or dot in it invites
// path-traversal foot-guns).
export function isValidEntryName(name: string): boolean {
  if (!name || name === '.' || name === '..' || name === 'node_modules') return false
  if (name.length > 64) return false
  return !name.includes('/') && !name.includes('\\')
}

export function entryDir(name: string): string {
  if (!isValidEntryName(name)) throw new Error(`Invalid entry name: ${name}`)
  return path.join(ENTRIES_DIR, name)
}

// The manifest half of an entry: entry.json holds display metadata plus config
// overrides (highest-precedence layer). All fields optional; shape mirrors the
// loose keys of AppConfig.
export interface EntryOverrides {
  description?: string
  settings?: Record<string, boolean | string | number>
  hooks?: AppConfig['hooks']
  mcpServers?: AppConfig['mcpServers']
  permissions?: AppConfig['permissions']
  customProviders?: AppConfig['customProviders']
  launcher?: LauncherDecl
  provider?: string
  model?: string
  theme?: string
  system?: string
}

// A "has entry" plugin's front-end declaration (see lib/launcher): when the
// active entry carries this, `meowcode` skips the Ink TUI and hands the
// process to the child. Relative args resolve against the entry dir.
export interface LauncherDecl {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export function isLauncherDecl(v: unknown): v is LauncherDecl {
  return !!v && typeof v === 'object' && typeof (v as LauncherDecl).command === 'string' && !!(v as LauncherDecl).command
}

// Read an entry's entry.json. Missing/corrupt → {} (never throws) so a broken
// manifest degrades to "no overrides" instead of breaking startup.
export function readEntryOverrides(name: string): EntryOverrides {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(fs.readFileSync(path.join(entryDir(name), 'entry.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
  // A self-referential "name" is meaningless (the dir already names the entry).
  delete raw.name
  return raw as EntryOverrides
}

export function entryExists(name: string): boolean {
  if (!isValidEntryName(name)) return false
  try {
    return fs.statSync(entryDir(name)).isDirectory()
  } catch {
    return false
  }
}

// Every validly-named subdirectory of ENTRIES_DIR, sorted by name, with the
// description pulled from its entry.json. Missing dir → [].
export function listEntries(): EntryMeta[] {
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(ENTRIES_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const out: EntryMeta[] = []
  for (const e of ents) {
    if (!e.isDirectory() || !isValidEntryName(e.name)) continue
    const dir = path.join(ENTRIES_DIR, e.name)
    const ov = readEntryOverrides(e.name)
    out.push({
      name: e.name,
      description: ov.description,
      hasLauncher: isLauncherDecl(ov.launcher),
      builtin: e.name === BUILTIN_ENTRY,
      dir,
    })
  }
  // The built-in TUI always leads: it is the default front-end, so it is what
  // you want row 1 to be even when it sorts alphabetically after something else.
  return out.sort((a, b) => (a.builtin ? -1 : b.builtin ? 1 : a.name.localeCompare(b.name)))
}

// The default entry lives at CONFIG_DIR/entry.json as { "default": "<name>" }.
const DEFAULT_ENTRY_FILE = path.join(CONFIG_DIR, 'entry.json')

export function getDefaultEntry(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(DEFAULT_ENTRY_FILE, 'utf8')) as { default?: unknown }
    return typeof j.default === 'string' && isValidEntryName(j.default) ? j.default : null
  } catch {
    return null
  }
}

// null clears the default — startup then falls back to the built-in TUI, which is
// what an unset default has always meant.
export function setDefaultEntry(name: string | null): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  if (name === null) {
    try { fs.unlinkSync(DEFAULT_ENTRY_FILE) } catch { /* already gone */ }
    return
  }
  if (!isValidEntryName(name)) throw new Error(`Invalid entry name: ${name}`)
  fs.writeFileSync(DEFAULT_ENTRY_FILE, JSON.stringify({ default: name }, null, 2))
}

// Create the built-in `tui` entry if it isn't there yet, so it shows up in every
// list alongside plugin entries and can be made the default like any other. Only
// entry.json is written — deliberately NOT settings.json, so activating `tui`
// layers nothing on top of the global config and `meowcode` and `meowcode tui`
// read and write exactly the same files. A user who wants the built-in entry to
// carry its own model/theme just drops a settings.json in there; from then on it
// behaves like any other entry. Idempotent, and never clobbers existing files.
export function materializeBuiltinEntry(): void {
  const dir = entryDir(BUILTIN_ENTRY)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return // unwritable — the built-in UI still works, it just won't be listed
  }
  writeIfAbsent(path.join(dir, 'entry.json'), JSON.stringify({ name: BUILTIN_ENTRY }, null, 2))
}

// --- Active-entry context ---------------------------------------------------
// Set ONCE at startup by the CLI (default entry or --entry). Every per-entry
// path decision routes through the helpers below so the rest of the codebase
// never needs to know whether an entry is active.

export interface ActiveEntry {
  name: string
  dir: string
}

let active: ActiveEntry | null = null

// Activate an entry (mkdir -p its dir so state writes always land) or clear to
// global mode with null. Idempotent — safe to call with the current entry.
export function activateEntry(name: string | null): ActiveEntry | null {
  if (name === null) {
    active = null
    return null
  }
  const dir = entryDir(name) // throws on invalid name
  fs.mkdirSync(dir, { recursive: true })
  active = { name, dir }
  return active
}

export function activeEntry(): ActiveEntry | null {
  return active
}

export function activeEntryName(): string | null {
  return active?.name ?? null
}

export function entryActive(): boolean {
  return active !== null
}

// Conversation state lives at the CONFIG_DIR root and is SHARED by every entry:
// sessions, memory (incl. projects/) and history are one continuous record of
// what you and the agent have done, no matter which front-end you happened to be
// driving. An entry swaps the *surface* and its wiring, never the history. These
// helpers therefore ignore `active` — the `kind` parameter is kept so callers
// read as before and so a future split has an obvious place to hook.
export function stateDir(kind: 'sessions' | 'memory' | 'projects' | 'mailbox'): string {
  return path.join(CONFIG_DIR, kind)
}

export function stateFile(kind: 'history'): string {
  return path.join(CONFIG_DIR, `${kind}.json`)
}

// --- Config layering --------------------------------------------------------

function readEntryConfig(dir: string): Partial<AppConfig> {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as Partial<AppConfig>
  } catch {
    return {} // missing/corrupt — treat as no layer
  }
}

// Apply the active entry's config layers on top of `base` (what loadConfig()
// read: global settings.json over defaults). Layer order: base → the entry's
// own settings.json → entry.json overrides. The settings bag merges key-by-key
// at each layer; the bag-shaped top-level keys (hooks/mcpServers/permissions/
// customProviders) are REPLACED when entry.json carries them. apiKey always
// comes from base (env-sourced) — never from entry files.
export function applyEntryOverrides(base: AppConfig): AppConfig {
  if (!active) return base
  const fileCfg = readEntryConfig(active.dir)
  const cfg: AppConfig = {
    ...base,
    ...fileCfg,
    settings: { ...base.settings, ...fileCfg.settings },
  }
  const ov = readEntryOverrides(active.name)
  if (ov.provider !== undefined) cfg.provider = ov.provider
  if (ov.model !== undefined) cfg.model = ov.model
  if (ov.theme !== undefined) cfg.theme = ov.theme
  if (ov.system !== undefined) cfg.system = ov.system
  if (ov.settings !== undefined) cfg.settings = { ...cfg.settings, ...ov.settings }
  if (ov.hooks !== undefined) cfg.hooks = ov.hooks
  if (ov.mcpServers !== undefined) cfg.mcpServers = anchorMcpServers(ov.mcpServers, active.dir)
  if (ov.permissions !== undefined) cfg.permissions = ov.permissions
  if (ov.customProviders !== undefined) cfg.customProviders = ov.customProviders
  cfg.apiKey = base.apiKey
  return cfg
}

// Anchor an entry.json's mcpServers args against the entry dir: a relative FILE
// arg ("server.js") ships INSIDE the entry (see the installer's shipFile), so at
// runtime it must resolve there — not against the session cwd, which is
// wherever the user happened to launch. Absolute paths are left alone. Only
// path-looking args are anchored — flags and values ("--port", "8080") must
// pass through untouched, so the heuristic is conservative: contains a slash or
// ends in a script/executable extension. (The installer's shipFile is the mirror
// image: it tries every relative arg but only copies ones that really exist.)
const PATH_ARG_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.py', '.rb', '.sh', '.bash', '.zsh', '.pl', '.php', '.exe', '.bat', '.cmd', '.com', '.ps1']

function looksLikePathArg(a: string): boolean {
  if (a.includes('/') || a.includes('\\') || a.startsWith('.')) return true
  const lower = a.toLowerCase()
  return PATH_ARG_EXTS.some((ext) => lower.endsWith(ext))
}

function anchorMcpServers(
  servers: NonNullable<AppConfig['mcpServers']>,
  dir: string,
): NonNullable<AppConfig['mcpServers']> {
  const out: NonNullable<AppConfig['mcpServers']> = {}
  for (const [name, srv] of Object.entries(servers)) {
    if (!srv || typeof srv !== 'object' || !Array.isArray(srv.args)) { out[name] = srv; continue }
    out[name] = {
      ...srv,
      args: srv.args.map((a) =>
        typeof a === 'string' && a && looksLikePathArg(a) && !path.isAbsolute(a) && !a.startsWith('~')
          ? path.join(dir, a)
          : a,
      ),
    }
  }
  return out
}

// saveConfig, but entry-aware: with an entry active, writes land in the entry's
// own settings.json (same 2-space format, apiKey stripped); otherwise it is the
// global saveConfig unchanged.
export function entryAwareSaveConfig(cfg: AppConfig): void {
  if (!active) {
    saveConfig(cfg)
    return
  }
  try {
    fs.mkdirSync(active.dir, { recursive: true })
    const { apiKey: _omit, ...persist } = cfg
    fs.writeFileSync(path.join(active.dir, 'settings.json'), JSON.stringify(persist, null, 2))
  } catch {
    // best-effort; config persistence is non-critical (same stance as saveConfig)
  }
}

// --- Entry creation ---------------------------------------------------------

// Template for /entry new and the installer: manifest fields plus initial
// content files for the skills/commands/agents dirs.
export interface EntryTemplate {
  description?: string
  settings?: Record<string, boolean | string | number>
  hooks?: AppConfig['hooks']
  mcpServers?: AppConfig['mcpServers']
  permissions?: AppConfig['permissions']
  customProviders?: AppConfig['customProviders']
  launcher?: LauncherDecl
  provider?: string
  model?: string
  theme?: string
  system?: string
  content?: {
    skills?: Record<string, string>
    commands?: Record<string, string>
    agents?: Record<string, string>
  }
}

const MANIFEST_KEYS = ['description', 'settings', 'hooks', 'mcpServers', 'permissions', 'customProviders', 'launcher', 'provider', 'model', 'theme', 'system'] as const

// Write a file only if absent — creation must never clobber user content.
function writeIfAbsent(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    fs.writeFileSync(file, content, { flag: 'wx' })
  } catch {
    // exists (or unwritable) — leave it alone
  }
}

export function createEntry(name: string, template?: EntryTemplate): void {
  // The built-in TUI entry is materialized at startup, never created by hand —
  // `/entry new tui` would otherwise silently reset a user's tui settings.
  if (name === BUILTIN_ENTRY) throw new Error(`'${BUILTIN_ENTRY}' is the built-in entry and cannot be created`)
  const dir = entryDir(name) // throws on invalid name
  fs.mkdirSync(dir, { recursive: true })
  // entry.json: the template's manifest fields plus the (redundant but handy)
  // name; absent keys are omitted entirely.
  const manifest: Record<string, unknown> = { name }
  if (template) {
    for (const k of MANIFEST_KEYS) {
      if (template[k] !== undefined) manifest[k] = template[k]
    }
  }
  writeIfAbsent(path.join(dir, 'entry.json'), JSON.stringify(manifest, null, 2))
  // Content dirs are created lazily — only when the template seeds them.
  const content = template?.content
  if (content?.skills) {
    for (const [key, body] of Object.entries(content.skills)) {
      // skill key "foo" (or "foo.md" / "foo.SKILL.md") → skills/foo/SKILL.md
      const skill = key.replace(/(\.SKILL)?\.md$/i, '')
      writeIfAbsent(path.join(dir, 'skills', skill, 'SKILL.md'), body)
    }
  }
  if (content?.commands) {
    for (const [key, body] of Object.entries(content.commands)) {
      const cmd = key.replace(/\.md$/i, '')
      writeIfAbsent(path.join(dir, 'commands', `${cmd}.md`), body)
    }
  }
  if (content?.agents) {
    for (const [key, body] of Object.entries(content.agents)) {
      const agent = key.replace(/\.md$/i, '')
      writeIfAbsent(path.join(dir, 'agents', `${agent}.md`), body)
    }
  }
}
