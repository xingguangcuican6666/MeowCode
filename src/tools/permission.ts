// Permission engine for the `permissionMode` + `autoModeInPlan` settings.
//
// Claude Code gates tool calls behind a permission mode: some modes run tools
// freely, some prompt before anything that changes the workspace, and "plan"
// mode forbids edits entirely so the agent researches then proposes a plan. We
// mirror that here. The provider consults `decidePermission` before each
// top-level tool call and either runs it, denies it (feeding the reason back to
// the model), or asks the user via an interactive dialog.
//
// The decision is intentionally pure and synchronous — the only async part
// (showing a dialog) lives in the provider/UI. Sub-agents can't show a dialog,
// so they only ever get the deterministic part of the policy (plan mode denies
// mutations); everything else a sub-agent may do runs.

import { globToRegExp } from '../lib/glob'
import path from 'node:path'
import os from 'node:os'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export function isPermissionMode(v: string | undefined): v is PermissionMode {
  return !!v && (PERMISSION_MODES as readonly string[]).includes(v)
}

/**
 * The next mode when the user presses shift+tab, cycling in PERMISSION_MODES
 * order and wrapping around (default → acceptEdits → plan → bypassPermissions →
 * default). Mirrors Claude Code's shift+tab mode cycling.
 */
export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const i = PERMISSION_MODES.indexOf(mode)
  return PERMISSION_MODES[(i + 1) % PERMISSION_MODES.length]
}

// Tools that change the workspace (write files or run arbitrary shell). Everything
// else in the toolset is read-only (read_file/grep/glob/list_dir) or an
// orchestration wrapper (task/plan/workflow/agent_*) that itself spawns sub-agents
// rather than mutating directly.
const MUTATING = new Set(['write_file', 'edit_file', 'notebook_edit', 'bash', 'monitor'])
// The file-editing tools specifically — `acceptEdits` auto-approves these but
// still prompts for `bash` (which can do anything).
const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'notebook_edit'])

export function isMutating(tool: string): boolean {
  // MCP tools (mcp__<server>__<tool>) are external calls that may do anything
  // (write files, hit the network), so they gate like `bash`: prompt in default
  // and acceptEdits, deny in plan. Kept as an inline prefix test so this module
  // stays dependency-free.
  return MUTATING.has(tool) || tool.startsWith('mcp__')
}

// ── Plan mode: which bash commands are research, not mutation ────────────────
//
// Plan mode is meant to let the agent INVESTIGATE — read files, grep, run the
// test suite — and forbid only the changes. Gating on the tool name alone denied
// every bash call, so `grep -rn foo src/` came back as "plan mode cannot modify
// the workspace", which is both wrong and useless: the model then had no way to
// look anything up. So classify the COMMAND rather than the tool.
//
// This is a fail-closed heuristic, not a sandbox, and it only ever runs in plan
// mode, where the user's intent is already "don't change anything". The answer
// decides between "run it" and "still ask", never between "run it" and "change
// something silently": the user's own allow/deny rules layer on top (see
// matchPermissionRule in providers/anthropic), so `Bash(curl *)` remains the
// escape hatch for anything listed here that you actually want.

// Shell syntax that can chain, redirect, substitute, glob or background another
// command, plus the two path shorthands that escape the workspace. Any of these
// disqualifies the whole line, whatever the leading word is — which is why
// `find . -name '*.ts'` is refused: the `*` is a glob expansion, and a glob is
// exactly how a traversal sneaks past a name check. `~` is refused for the same
// reason in miniature (a home path is off-limits by construction), which is why
// `git diff HEAD~1` needs `git diff HEAD` — one positional ref and no shorthand.
// `&` is NOT here: that would reject the `&&` of a read-only chain, which is
// precisely the shape this exists to admit. A backgrounded command (`cmd &`) is
// caught separately — see the lone-& check below.
const PLAN_UNSAFE_SYNTAX = /[;|<>`$(){}[\]*?~!#]/

// Interpreter-driven commands. A `node -e` / `python -c` / `ruby -e` string can
// call fs.rmSync, and no name-based screen can see inside it, so the runner alone
// is refused. A FILE argument (`node build.js`) is just as arbitrary, so these
// entries qualify only with no argument at all — which in practice means they are
// admitted for their bare invocation (`node --version`) and little else. The test
// / typecheck / lint runners are the deliberate exception: they are how a plan
// gets verified, and they read the project rather than the user's home.
const PLAN_INTERPRETERS: Record<string, { allowArgs?: Set<string> }> = {
  node: {}, python: {}, python3: {}, ruby: {}, perl: {}, php: {}, deno: {}, bun: {},
  npx: { allowArgs: new Set(['tsc', 'eslint', 'vitest', 'jest', 'prettier', 'biome', 'mypy', 'ruff']) },
  npm: { allowArgs: new Set(['run', 'test', 'ls', 'list', 'view', 'outdated', 'why', 'search', 'prefix', 'exec']) },
  pnpm: { allowArgs: new Set(['run', 'test', 'list', 'ls', 'why', 'outdated', 'view']) },
  yarn: { allowArgs: new Set(['run', 'test', 'list', 'info', 'why', 'outdated']) },
  pip: { allowArgs: new Set(['list', 'show', 'freeze', 'inspect', 'check']) },
  pip3: { allowArgs: new Set(['list', 'show', 'freeze', 'inspect', 'check']) },
  cargo: { allowArgs: new Set(['tree', 'metadata', 'search', 'locate-project', 'verify-project', 'check', 'test', 'clippy', 'fmt', 'build']) },
  go: { allowArgs: new Set(['list', 'env', 'version', 'vet', 'doc', 'test', 'build']) },
}

// Leaf commands whose NAME is the whole story: they read, or they write, and
// nothing about their arguments turns a read into a write. Everything absent
// from this set is refused, because the cost of a false "refused" is one
// permission prompt while the cost of a false "read" is a change made while the
// user asked for a plan.
const PLAN_READ_ONLY = new Set([
  // inspection
  'ls', 'pwd', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'tree', 'fd', 'du', 'df', 'basename', 'dirname', 'realpath', 'readlink',
  'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum', 'cksum',
  // search
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'which', 'whereis', 'type',
  // environment / process / system state — these READ state
  'echo', 'printf', 'env', 'printenv', 'set', 'whoami', 'id', 'groups', 'hostname',
  'uname', 'date', 'uptime', 'ps', 'top', 'free', 'lscpu', 'lsblk', 'sysctl',
  'who', 'w', 'last', 'dmesg', 'lsof', 'netstat', 'ss', 'ip', 'ifconfig',
  'jq', 'yq', 'column', 'sort', 'uniq', 'cut', 'tr', 'nl', 'fold', 'rev', 'tac', 'seq',
  // compilers / linters: read sources, write only build artifacts
  'tsc', 'eslint', 'prettier', 'biome', 'ruff', 'mypy', 'pyright', 'flake8', 'black', 'isort',
  'vitest', 'jest', 'mocha', 'pytest', 'tox', 'ava', 'tape',
  'clang', 'clang-tidy', 'gcc', 'g++', 'cc', 'ldd', 'nm', 'objdump', 'strings',
])

// `sed` reads and writes in the same invocation — `sed -i` edits in place,
// `sed s/x/y/ f > g` redirects — and its two modes are distinguished by an
// argument, so it gets no allow-list entry at all. Same reasoning as the
// interpreters: `awk` and `sed` are a scripting language with write verbs
// (system(), print > "file", gsub on an array), so neither is admitted.

// git needs its own split, because git's first word never identifies the
// operation: `git log` reads and `git log --format=%H --output=x` writes a file,
// `git branch` reads and `git branch -d x` deletes a ref. The rule is therefore
// per-subcommand rather than per-verb.
const GIT_READ: Record<string, { maxArgs?: number }> = {
  status: {}, log: { maxArgs: 1 }, show: {}, diff: {}, blame: {}, describe: {},
  'rev-parse': {}, 'rev-list': {}, shortlog: {}, reflog: {}, 'ls-files': {},
  'ls-tree': {}, 'ls-remote': {}, 'cat-file': {}, whatchanged: {}, 'name-rev': {},
  'merge-base': {}, 'symbolic-ref': {}, 'count-objects': {}, var: {}, annotate: {},
  'show-ref': {}, config: { maxArgs: 1 }, help: {}, version: {},
}

const GIT_WRITES = new Set([
  'add', 'rm', 'mv', 'commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'reset',
  'checkout', 'switch', 'restore', 'clean', 'apply', 'cherry-pick', 'revert', 'tag',
  'branch', 'stash', 'gc', 'repack', 'prune', 'filter-branch', 'submodule', 'am',
  'notes', 'update-ref', 'worktree', 'bisect', 'update-index', 'sparse-checkout',
  'fast-import', 'format-patch', 'patch-id', 'diff-tree', 'diff-index', 'write-tree',
  'commit-tree', 'hash-object', 'mktree', 'update-server-info', 'interpret-trailers',
])

// Registry / VCS wrappers that read when given a read subcommand.
const PLAN_READ_ONLY_SUBS: Record<string, Set<string>> = {
  docker: new Set(['ps', 'images', 'logs', 'inspect', 'version', 'info']),
  kubectl: new Set(['get', 'describe', 'logs', 'explain', 'version', 'api-resources', 'top']),
  systemctl: new Set(['status', 'show', 'list-units', 'list-unit-files', 'is-active', 'is-enabled', 'cat']),
  gh: new Set(['pr', 'issue', 'repo', 'release', 'run', 'workflow', 'api', 'auth', 'search', 'gist', 'status', 'browse', 'config']),
}

/**
 * Is this bash call read-only enough to run while planning? Returns false
 * whenever the answer is not obvious, so plan mode never runs a command whose
 * effect this classifier cannot vouch for.
 */
export function isPlanReadOnlyCommand(command: string): boolean {
  const raw = String(command ?? '').trim()
  if (!raw) return false
  // Screen the WHOLE line first: a redirection, pipe, subshell, glob or ~ path
  // anywhere decides the answer, no matter how innocent the leading word is.
  if (PLAN_UNSAFE_SYNTAX.test(raw)) return false

  // `&&` / `||` chain read-only commands, so split on them: every segment has to
  // qualify on its own. Splitting on the OPERATOR rather than a whitespace token
  // means a chain written `cat a&&grep b` separates too.
  const segments: string[][] = []
  let current: string[] = []
  for (const seg of raw.split(/&&|\|\|/)) {
    current = seg.split(/\s+/).filter(Boolean)
    if (current.length === 0) return false
    segments.push(current)
  }

  return segments.every((seg) => {
    // A lone `&` (background, `cmd &`) survived the unsafe-syntax screen so that
    // `&&` could, and it is not a valid argument of anything below — refuse it
    // here rather than letting an allow-listed command absorb it.
    if (seg.some((w) => w.includes('&'))) return false
    // Strip a leading VAR=value assignment (`FOO=1 cmd`) and an `env` wrapper.
    let words = seg.filter((w, i) => !(i === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)))
    if (words[0] === 'env') words = words.slice(1)
    if (words.length === 0) return false

    // A bare path (`./scripts/check.sh`) is not in the allow-list: we can't read
    // its body, so it stays gated.
    const cmd = words[0].replace(/^.*\//, '').toLowerCase()

    if (cmd === 'git') return planReadOnlyGit(words)

    const subs = PLAN_READ_ONLY_SUBS[cmd]
    if (subs) return subs.has(words[1]?.toLowerCase() ?? '')

    const interp = PLAN_INTERPRETERS[cmd]
    if (interp) {
      const sub = words[1]?.toLowerCase()
      if (!sub) return true                                    // `node --version`
      return interp.allowArgs?.has(sub) === true              // otherwise read-only subcommand
    }

    // `make -n` prints the commands instead of running them, but `make` writes;
    // an interpreter reaching a makefile can run anything, so only the dry-run
    // forms are admitted. A bare `make` is not.
    if (cmd === 'make') return words[1] === '-n' || words[1] === '--dry-run' || words[1] === '--just-print'

    return PLAN_READ_ONLY.has(cmd)
  })
}

function planReadOnlyGit(words: string[]): boolean {
  const sub = words[1]?.toLowerCase()
  if (!sub || GIT_WRITES.has(sub)) return false
  const spec = GIT_READ[sub]
  if (!spec) return false
  // `git log HEAD~1` reads; `git log --format=%H --output=x` writes a file, so a
  // long argument list is not evidence of reading. The few verbs whose arguments
  // are genuinely a revision spec get one positional argument.
  if (spec.maxArgs !== undefined) {
    const rest = words.slice(2)
    if (rest.length > spec.maxArgs) return false
    if (rest.some((w) => w.startsWith('-'))) return false
  }
  return true
}

export type PermissionAction =
  | { action: 'allow' }
  | { action: 'ask' }
  | { action: 'deny'; reason: string }

const PLAN_DENY_REASON =
  '当前处于 plan（规划）权限模式：只读研究可用，但不能修改工作区。请先给出计划，待用户确认后再执行改动。'

/**
 * Decide how a tool call should be handled under the given permission mode.
 * `autoModeInPlan` lets read-only tools run without a prompt while planning.
 * `sub` marks a sub-agent call — sub-agents can't show a dialog, so in plan mode
 * they inherit the deterministic read-only denial, and in other modes they return
 * 'ask' for mutating tools (the caller must route or deny, since sub has no dialog).
 */
export function decidePermission(
  mode: PermissionMode,
  tool: string,
  opts: { autoModeInPlan?: boolean; sub?: boolean; input?: Record<string, unknown> } = {},
): PermissionAction {
  const { autoModeInPlan = false, sub = false } = opts

  if (mode === 'bypassPermissions') return { action: 'allow' }

  const mutating = isMutating(tool)

  if (mode === 'plan') {
    // Plan mode is read-only: never edit, even via a sub-agent. `bash` is the
    // one tool whose NAME says nothing about whether it mutates, so a read-only
    // COMMAND (see isPlanReadOnlyCommand) is the exception — otherwise grep and
    // `git status` get refused for "modifying the workspace", which they don't.
    if (mutating && !(tool === 'bash' && isPlanReadOnlyCommand(String(opts.input?.command ?? '')))) {
      return { action: 'deny', reason: PLAN_DENY_REASON }
    }
    // Read-only tools: auto-run when autoModeInPlan is on, else prompt (top level)
    // — sub-agents always proceed since they have no dialog.
    if (autoModeInPlan || sub) return { action: 'allow' }
    return { action: 'ask' }
  }

  // Sub-agents can't prompt: mutating tools need parent approval (return 'ask' so
  // the caller routes or denies), non-mutating tools proceed.
  if (sub) {
    if (mutating) return { action: 'ask' }
    return { action: 'allow' }
  }

  if (!mutating) return { action: 'allow' }

  if (mode === 'acceptEdits') {
    // Auto-accept file edits ONLY within the working directory and excluding
    // protected paths (.git, .meowcode, shell rc files). This mirrors Claude Code's
    // acceptEdits behavior: safe automation for in-project changes, but still prompt
    // for anything that could affect the user's system or repository integrity.
    if (EDIT_TOOLS.has(tool)) {
      const target = ruleTarget(tool, opts.input || {})
      if (target && isProtectedPath(target)) {
        // Protected path (outside workspace or sensitive file) — prompt the user.
        return { action: 'ask' }
      }
      return { action: 'allow' }
    }
    return { action: 'ask' }
  }

  // default mode: confirm every mutating call.
  return { action: 'ask' }
}

// ── Persistent permission rules ──────────────────────────────────────────────
//
// A user-managed layer on top of the mode (Claude Code's allow/deny/ask lists).
// Rules are strings: a bare tool name (`bash`, `Edit`) matches every call to it,
// or `Tool(pattern)` matches when the call's target — the command for bash, the
// path for file tools, the url/domain for web_fetch, the pattern for grep/glob —
// glob-matches `pattern` (`*` = any run of chars). Tool names are matched loosely
// so Claude Code's capitalized aliases (`Bash`, `Edit`, `Read`, `WebFetch`) map to
// our snake_case tools; a rule tool token containing `*` globs the raw tool name
// (handy for `mcp__server__*`). web_fetch also accepts `domain:example.com`.

export interface PermissionRules {
  allow?: string[]
  deny?: string[]
  ask?: string[]
}

// Claude Code–style capitalized tool names → our tool ids (keyed by the name with
// underscores stripped and lowercased, so both `Edit` and `edit_file` resolve).
const TOOL_ALIASES: Record<string, string> = {
  bash: 'bash', shell: 'bash',
  edit: 'edit_file', editfile: 'edit_file', multiedit: 'edit_file',
  write: 'write_file', writefile: 'write_file',
  read: 'read_file', readfile: 'read_file',
  notebookedit: 'notebook_edit',
  webfetch: 'web_fetch', fetch: 'web_fetch',
  websearch: 'web_search', search: 'web_search',
  grep: 'grep', glob: 'glob', listdir: 'list_dir', ls: 'list_dir',
}

// Shell metacharacters that delimit commands or redirect output: when a bash rule
// pattern contains any of these, the whole pattern must match the command exactly
// (no glob expansion) — otherwise "git *" would match "git status && rm -rf /" via
// the `*` wildcard, letting a chained command bypass the intent.
const BASH_META = /[;&|<>$()`]/

// Safe glob matching for bash commands: if the pattern contains shell metacharacters
// (command separators, redirects, subshells) it must match exactly (no wildcards),
// else compile as a glob. This prevents "git *" from matching "rm -rf / && git ok".
function bashGlobRe(pattern: string): RegExp {
  if (BASH_META.test(pattern)) {
    // Exact match only — escape everything.
    const esc = pattern.replace(/[.+^$()|[\]\\*?]/g, '\\$&')
    return new RegExp(`^${esc}$`)
  }
  // No metacharacters: safe to glob-expand.
  return globToRegExp(pattern)
}

// Is this path protected from auto-accept in acceptEdits mode? Protected paths are:
// - Outside the working directory (absolute paths not under cwd, or ~ paths)
// - Inside .git/ or .meowcode/ (repo/tool internals)
// - Shell rc files (.bashrc, .zshrc, etc.) anywhere in the tree
// Returns true → prompt the user; false → safe to auto-accept.
function isProtectedPath(absolutePath: string): boolean {
  if (!absolutePath) return false

  // Normalize both paths for comparison (resolve symlinks, trailing slashes)
  const normPath = path.resolve(absolutePath)
  const normCwd = path.resolve(process.cwd())

  // Outside working directory?
  if (!normPath.startsWith(normCwd + path.sep) && normPath !== normCwd) {
    return true
  }

  // Protected directories within the workspace
  const rel = path.relative(normCwd, normPath)
  const parts = rel.split(path.sep)
  if (parts[0] === '.git' || parts[0] === '.meowcode') {
    return true
  }

  // Shell rc files (anywhere in tree, including ~/ edits that somehow got through)
  const basename = path.basename(normPath)
  const rcFiles = ['.bashrc', '.bash_profile', '.zshrc', '.zshenv', '.profile', '.fishrc', '.config/fish/config.fish']
  if (rcFiles.some(rc => normPath.endsWith(rc) || basename === rc)) {
    return true
  }

  return false
}

// Does a rule's tool token refer to the tool actually being called?
function toolMatches(ruleTool: string, actual: string): boolean {
  const r = ruleTool.trim()
  if (!r) return false
  if (r === '*') return true
  if (r.includes('*')) return globToRegExp(r).test(actual)      // e.g. mcp__github__*
  const rl = r.toLowerCase()
  if (rl === actual.toLowerCase()) return true
  return TOOL_ALIASES[rl.replace(/_/g, '')] === actual
}

// The string a rule's pattern is matched against, per tool. Empty when the tool
// has no natural target (then only a bare, pattern-less rule can match it).
// File paths are normalized to absolute (resolve ~, relative paths, ..) so rules
// reliably match regardless of how the tool input spelled the path.
function ruleTarget(tool: string, input: Record<string, unknown>): string {
  const i = input ?? {}
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')

  // Normalize a file path: resolve ~, relative paths, and .. to absolute
  const normalizePath = (p: string): string => {
    if (!p) return ''
    const expanded = p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p
    return path.resolve(process.cwd(), expanded)
  }

  switch (tool) {
    case 'bash': return s(i.command)
    case 'read_file': case 'write_file': case 'edit_file':
      return normalizePath(s(i.path) || s(i.file_path))
    case 'notebook_edit':
      return normalizePath(s(i.notebook_path) || s(i.path))
    case 'web_fetch': return s(i.url)
    case 'web_search': return s(i.query)
    case 'grep': case 'glob': return s(i.pattern)
    case 'list_dir': return normalizePath(s(i.path))
    default: return tool.startsWith('mcp__') ? tool : ''
  }
}

// The host of a URL, for web_fetch `domain:` rules. '' when unparseable.
function urlHost(url: string): string {
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

// Does one rule string match this call?
function ruleMatches(rule: string, tool: string, input: Record<string, unknown>): boolean {
  const trimmed = rule.trim()
  if (!trimmed) return false
  // Split `Tool(pattern)` → tool token + inner pattern; a bare token has none.
  const m = /^([^()]+)\(([\s\S]*)\)\s*$/.exec(trimmed)
  const toolTok = (m ? m[1] : trimmed).trim()
  const pattern = m ? m[2].trim() : undefined
  if (!toolMatches(toolTok, tool)) return false
  if (pattern === undefined || pattern === '') return true      // bare tool rule
  const target = ruleTarget(tool, input)
  // web_fetch domain rule: match the URL host (exact or a parent domain).
  if (tool === 'web_fetch' && pattern.toLowerCase().startsWith('domain:')) {
    const want = pattern.slice('domain:'.length).trim().toLowerCase()
    const host = urlHost(target)
    return !!want && !!host && (host === want || host.endsWith(`.${want}`))
  }
  if (!target) return false
  // Bash commands need special handling: a pattern with shell metacharacters must
  // match exactly (no glob expansion) to prevent "git *" from matching chained cmds.
  const re = tool === 'bash' ? bashGlobRe(pattern) : globToRegExp(pattern)
  return re.test(target)
}

function anyRuleMatches(rules: string[] | undefined, tool: string, input: Record<string, unknown>): boolean {
  return Array.isArray(rules) && rules.some((r) => ruleMatches(r, tool, input))
}

/**
 * Evaluate the persistent rules for a call. Precedence: a matching `deny` wins,
 * then `ask`, then `allow` (so a user can force-prompt a subset of a broadly
 * allowed tool). Returns undefined when no rule matches, so the caller falls back
 * to the mode decision.
 */
export function matchPermissionRule(
  tool: string,
  input: Record<string, unknown>,
  rules: PermissionRules | undefined,
): 'allow' | 'deny' | 'ask' | undefined {
  if (!rules) return undefined
  if (anyRuleMatches(rules.deny, tool, input)) return 'deny'
  if (anyRuleMatches(rules.ask, tool, input)) return 'ask'
  if (anyRuleMatches(rules.allow, tool, input)) return 'allow'
  return undefined
}

export const DENY_RULE_REASON =
  '该工具调用被权限规则拒绝（deny）。请改用其它方式完成任务；如属误配，可让用户用 /permissions 调整规则。'
