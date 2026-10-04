// Entry installer — `meowcode entry install <spec>` / `meowcode entry remove
// <name>`. Specs mirror dsh's `plugin add`: an npm package (`pkg`, `pkg@1.2.3`,
// `@scope/pkg`), a git URL (`https://github.com/user/repo[.git]` or a
// `user/repo` shorthand), or a local directory (`./path` / absolute). The
// template comes from the source's package.json — "meowcode"."entry" — or,
// failing that, a repo-root entry.json. (An "anycode"."entry" alias used to be
// accepted here; it is gone along with the rest of the pre-rename surface, so
// republish templates under "meowcode".) The entry NAME is the template's own
// "name" field, else the
// package name (scope stripped, @scope/foo → foo), else the spec-derived name
// (git repo name / bare npm spec / dir basename). Install = createEntry()
// (which never overwrites) plus a never-overwrite copy of any shipped skills/
// commands/agents dirs from the source root. Remove rm -rf's the entry dir (never
// the built-in `tui` entry, which startup re-materializes) but REFUSES to destroy
// sessions/ or memory/ content without --force (user data protection), and clears
// the default-entry pointer if it pointed here.
//
// npm/git/tar are driven via child_process — no new npm deps. Every failure
// raises EntryInstallError carrying a clean one-line message; the cli.tsx
// wiring catches it, prints to stderr and exits 1 — nothing throws past main().
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_ENTRY, createEntry, entryDir, entryExists, getDefaultEntry, isValidEntryName, setDefaultEntry } from './entries'
import type { EntryTemplate } from './entries'

// The only error type that escapes this module — the CLI catches it and prints
// `Error: <message>` + exit 1, so every failure path reads as one clean line.
export class EntryInstallError extends Error {}
function fail(msg: string): never {
  throw new EntryInstallError(msg)
}

// Run a child to completion. npm/git installs are one-shot synchronous steps,
// so spawnSync is right (same stance as lib/editor); a missing binary
// (ENOENT) maps to a clear message instead of Node's raw spawn exception.
interface RunResult { code: number; out: string; err: string }
function run(cmd: string, args: string[]): RunResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === 'ENOENT') fail(`\`${cmd}\` is not installed or not on PATH`)
    fail(r.error.message)
  }
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

// Collapse a child's multi-line stderr to the one line worth showing. Both git
// ("Cloning into '...'") and npm (notice lines) prefix real diagnostics, so
// prefer an explicit fatal:/error: line, else take the last non-empty one.
function oneLine(s: string): string {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[lines.length - 1] ?? ''
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

// @scope/foo → foo (npm names may be scoped; entry names are bare dir names).
function stripScope(name: string): string {
  return name.startsWith('@') && name.includes('/') ? name.slice(name.indexOf('/') + 1) : name
}

// Local dir: explicit ./ ../ /absolute prefix, or any existing directory. A
// bare `user/repo` that happens to be a real local dir wins over the git
// shorthand — you can always disambiguate with a https:// URL.
function isLocalDir(spec: string): boolean {
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../') || path.isAbsolute(spec)) return true
  return isDir(spec)
}

// Git: a real URL, an ssh remote, or the `user/repo` shorthand. Scoped npm
// names (@scope/pkg) can't collide — '@' is not in the shorthand charset.
function isGitSpec(spec: string): boolean {
  return /^https?:\/\//.test(spec) || /^git@/.test(spec) || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spec)
}

function repoNameFromUrl(url: string): string {
  return url.replace(/\.git$/, '').replace(/\/+$/, '').split('/').pop() ?? url
}

// --- Manifest resolution ----------------------------------------------------

// The template as read from disk, before validation. `name` rides along
// outside EntryTemplate (createEntry takes the name separately) but a
// template may still declare one, and it wins the naming decision.
type RawTemplate = EntryTemplate & Record<string, unknown>
interface Manifest { template: RawTemplate; pkgName?: string }

function readJson(file: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> } catch { return null }
}

// package.json's "meowcode"."entry", else a repo-root entry.json used as the
// template itself.
function manifestFrom(root: string): Manifest | null {
  const pkg = readJson(path.join(root, 'package.json'))
  if (pkg) {
    const brand = pkg.meowcode
    if (brand && typeof brand === 'object') {
      const t = (brand as Record<string, unknown>).entry
      if (t && typeof t === 'object') {
        return { template: t as RawTemplate, pkgName: typeof pkg.name === 'string' ? pkg.name : undefined }
      }
    }
  }
  const j = readJson(path.join(root, 'entry.json'))
  if (j) return { template: j as RawTemplate }
  return null
}

interface ResolvedSource { name: string; template: RawTemplate; contentRoot: string }

// Turn a source root (extracted package / clone / local dir) into the template
// plus the entry name. Name precedence: the template's "name", the package
// name (scope stripped), then the spec-derived fallback (repo name / bare npm
// spec / dir basename).
function fromRoot(root: string, what: string, fallbackName: string): ResolvedSource {
  const mf = manifestFrom(root)
  if (!mf) {
    fail(`${what}: no "meowcode"."entry" field in package.json and no entry.json at its root`)
  }
  const name = (typeof mf.template.name === 'string' && mf.template.name) || stripScope(mf.pkgName ?? '') || stripScope(fallbackName)
  if (!isValidEntryName(name)) fail(`"${name}" is not a valid entry name (${what})`)
  return { name, template: mf.template, contentRoot: root }
}

function resolveLocal(spec: string): ResolvedSource {
  const abs = path.resolve(spec)
  if (!isDir(abs)) fail(`no such directory: ${spec}`)
  return fromRoot(abs, `local directory ${spec}`, path.basename(abs))
}

function resolveGit(spec: string, tmp: string): ResolvedSource {
  const url = /^https?:\/\/|^git@/.test(spec) ? spec : `https://github.com/${spec}`
  const dest = path.join(tmp, 'repo')
  const r = run('git', ['clone', '--depth', '1', url, dest])
  if (r.code !== 0) fail(`git clone failed for ${url}${r.err ? ': ' + oneLine(r.err) : ''}`)
  return fromRoot(dest, `git repository ${url}`, repoNameFromUrl(url))
}

function resolveNpm(spec: string, tmp: string): ResolvedSource {
  const r = run('npm', ['pack', spec, '--pack-destination', tmp])
  if (r.code !== 0) fail(`npm pack ${spec} failed${r.err ? ': ' + oneLine(r.err) : ''}`)
  // `npm pack` prints the packed tarball's filename as its last stdout line.
  const tarball = r.out.split('\n').map((l) => l.trim()).filter(Boolean).pop()
  if (!tarball) fail(`npm pack ${spec} produced no tarball`)
  const extractDir = path.join(tmp, 'extracted')
  fs.mkdirSync(extractDir)
  const x = run('tar', ['-xzf', path.join(tmp, tarball), '-C', extractDir])
  if (x.code !== 0) fail(`could not extract ${tarball}${x.err ? ': ' + oneLine(x.err) : ''}`)
  // npm tarballs always nest everything under a `package/` dir.
  const root = path.join(extractDir, 'package')
  // @scope/pkg@1.2.3 → pkg: take the last path segment, drop the version tag.
  const bare = stripScope(spec.split('/').pop() ?? spec).replace(/@[^@]*$/, '')
  return fromRoot(root, `npm package ${spec}`, bare)
}

// --- Install / remove -------------------------------------------------------

// Copy a tree without clobbering: files already at the destination (at any
// depth) are left alone — same stance as createEntry's writeIfAbsent, so a
// re-install can add content but never destroy user edits.
function copyTreeNoOverwrite(src: string, dst: string): number {
  fs.mkdirSync(dst, { recursive: true })
  let n = 0
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name)
    const to = path.join(dst, e.name)
    if (e.isDirectory()) n += copyTreeNoOverwrite(from, to)
    else if (!fs.existsSync(to)) { fs.copyFileSync(from, to); n++ }
  }
  return n
}

export interface InstallOptions { force?: boolean }

// Install the entry described by `spec` (npm package / git URL / local dir).
// Returns a one-line success message; every failure throws EntryInstallError.
// An existing entry is refused unless force is passed — and even then no
// already-present file is overwritten, only new content is added.
export function installEntry(spec: string, opts?: InstallOptions): string {
  const force = !!opts?.force
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-install-'))
  try {
    const src = isLocalDir(spec) ? resolveLocal(spec) : isGitSpec(spec) ? resolveGit(spec, tmp) : resolveNpm(spec, tmp)
    const dir = entryDir(src.name)
    const existed = entryExists(src.name)
    if (existed && !force) {
      fail(`entry "${src.name}" already exists (${dir}); pass --force to install over it (existing files are never overwritten)`)
    }
    createEntry(src.name, src.template)
    // Ship any skills/commands/agents dirs from the source root into the
    // entry — again never overwriting files that are already there.
    let copied = 0
    for (const kind of ['skills', 'commands', 'agents'] as const) {
      const from = path.join(src.contentRoot, kind)
      if (isDir(from)) copied += copyTreeNoOverwrite(from, path.join(dir, kind))
    }
    // Ship files the manifest references by relative path: launcher args and
    // mcpServers args resolve against the ENTRY dir at runtime (see
    // readLauncherConfig / applyEntryOverrides), so a shipped `launcher.js` or
    // `server.js` must physically land there. Absolute paths are the author's
    // own machine — left as-is, never copied.
    const shipFile = (rel: string): void => {
      if (!rel || path.isAbsolute(rel) || rel.startsWith('~')) return
      const from = path.normalize(path.join(src.contentRoot, rel))
      if (!from.startsWith(src.contentRoot + path.sep)) return // escape attempt
      try { if (!fs.statSync(from).isFile()) return } catch { return }
      const to = path.join(dir, rel)
      if (fs.existsSync(to)) return
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      copied++
    }
    const tpl = src.template as RawTemplate & {
      launcher?: { args?: unknown }
      mcpServers?: Record<string, { args?: unknown }>
    }
    if (Array.isArray(tpl.launcher?.args)) {
      for (const a of tpl.launcher.args) if (typeof a === 'string') shipFile(a)
    }
    if (tpl.mcpServers && typeof tpl.mcpServers === 'object') {
      for (const srv of Object.values(tpl.mcpServers)) {
        if (srv && Array.isArray(srv.args)) {
          for (const a of srv.args) if (typeof a === 'string') shipFile(a)
        }
      }
    }
    const verb = existed ? 'Refreshed' : 'Installed'
    return `${verb} entry "${src.name}"${copied ? ` (+${copied} content file${copied === 1 ? '' : 's'})` : ''} → ${dir}`
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort scratch cleanup */ }
  }
}

// Remove an installed entry. The built-in `tui` entry is refused outright — it is
// materialized on every startup, so deleting it would only make it reappear (and a
// user who wants the built-in UI back has no other way to get it). Refuses when
// the entry holds user data — anything at all under sessions/ or memory/ (only
// possible for an entry created before those became global) — unless force is
// passed; clears the default-entry pointer when the removed entry was the
// default. Returns a one-line report of what was removed.
export function removeEntry(name: string, opts?: InstallOptions): string {
  const force = !!opts?.force
  if (!isValidEntryName(name)) fail(`"${name}" is not a valid entry name`)
  if (name === BUILTIN_ENTRY) fail(`"${BUILTIN_ENTRY}" is the built-in entry and cannot be removed`)
  const dir = entryDir(name)
  if (!entryExists(name)) fail(`no entry named "${name}" in ~/.meowcode/entries`)
  if (!force) {
    for (const kind of ['sessions', 'memory'] as const) {
      let hasData = false
      try { hasData = fs.readdirSync(path.join(dir, kind)).length > 0 } catch { /* absent — fine */ }
      if (hasData) fail(`entry "${name}" contains ${kind}/ data — pass --force to delete it anyway`)
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  const wasDefault = getDefaultEntry() === name
  if (wasDefault) setDefaultEntry(null)
  return `Removed entry "${name}" (${dir})${wasDefault ? ' and cleared the default entry' : ''}`
}

// The cli.tsx wiring for `meowcode entry install|remove`: parses --force out
// of the raw args, finds the operand, and returns the success line — or throws
// EntryInstallError (usage errors included) for the caller to print + exit 1.
// Kept here so the CLI-side footprint is one try/catch.
export function entryInstallCommand(sub: 'install' | 'remove', args: string[]): string {
  const force = args.includes('--force') || args.includes('-f')
  const operand = args.find((a) => !a.startsWith('-'))
  if (sub === 'install') {
    if (!operand) fail('usage: meowcode entry install <npm-package | git-url | user/repo | ./dir>')
    return installEntry(operand, { force })
  }
  if (!operand) fail('usage: meowcode entry remove <name>')
  return removeEntry(operand, { force })
}
