import React from 'react'
import { PassThrough } from 'node:stream'
import { render } from 'ink'
import { App, type SessionSnapshot } from './app'
import type { AppConfig } from './types'
import { loadConfig, withLiveKey } from './config'
import { getProvider } from './providers'
import { NAME, VERSION } from './version'
import { newSessionId, saveSession, loadSession, latestSession, forkSession } from './lib/sessions'
import { KITTY_ON, KITTY_OFF, createKittyTranslator } from './lib/kittykeys'
import { StringDecoder } from 'node:string_decoder'
// Fullscreen control sequences (alternate screen + mouse/paste enables). MeowCode
// owns the whole viewport the way Claude Code does — the transcript is a
// self-managed scroll container, NOT native terminal scrollback: no <Static>, so
// the terminal never accumulates a scrollback buffer and overlays repaint cleanly.
// The exact sequences (and the Terminal.app mouse gate) live in lib/termmodes so
// the /editor bridge in app.tsx can leave and re-enter the same modes.
import { ALT_ON, ALT_OFF, MOUSE_ON, MOUSE_OFF, CLEAR } from './lib/termmodes'
// `meowcode entry install|remove` — entry (front-end) management. The heavy
// lifting lives in lib/entryInstall; this wiring only parses --force, prints
// the one-line result (or the error) and exits — nothing throws past main().
import { EntryInstallError, entryInstallCommand } from './lib/entryInstall'
import {
  activateEntry, activeEntry, entryExists, getDefaultEntry,
  listEntries, materializeBuiltinEntry, setDefaultEntry, activeEntryName,
} from './lib/entries'
import { readLauncherConfig, runLauncher } from './lib/launcher'
// The AnyCode→MeowCode rename migration (one-time question at startup, see
// lib/legacyDir.ts for why it must run before the entry/config are resolved).
import { CONFIG_DIR, offerLegacyMigration, reportMergeOutcome, type LegacyDirInfo } from './lib/legacyDir'
import { LegacyDirDialog, type LegacyChoice } from './components/LegacyDirDialog'
import { getTheme, ThemeProvider } from './theme'
import {
  getSetting, effortDirective, outputStyleDirective, workflowSizeDirective, resolveThinkingBudget,
} from './lib/settings'
import { resolveLang, setLang } from './lib/i18n'
import { LangProvider } from './hooks/useT'
import { AGENT_SYSTEM } from './hooks/chat-helpers'
import { standingPreamble } from './lib/memory'
import { projectInstructionsPreamble } from './lib/projectInstructions'
import { customAgentCatalog } from './tools/orchestration'
import { isPermissionMode, PERMISSION_MODES } from './tools/permission'

const argv = process.argv.slice(2)

function has(...flags: string[]): boolean {
  return argv.some((a) => flags.includes(a))
}

// Returns the value for --flag / -f. Distinguishes three cases:
//   undefined -> flag absent
//   ''        -> flag present but no usable value (next token is another flag,
//                or the flag was last) — callers decide whether that's an error
//   <string>  -> the value (from `--flag value` or `--flag=value`)
function flagValue(...names: string[]): string | undefined {
  for (const name of names) {
    const i = argv.findIndex((a) => a === name)
    if (i >= 0) {
      const next = argv[i + 1]
      // Don't greedily swallow the following option as if it were the value.
      return next !== undefined && !next.startsWith('-') ? next : ''
    }
    const eq = argv.find((a) => a.startsWith(name + '='))
    if (eq) return eq.slice(eq.indexOf('=') + 1)
  }
  return undefined
}

function printHelp(): void {
  process.stdout.write(`${NAME} v${VERSION} — a Claude Code–style coding agent

Usage:
  meowcode                      Start an interactive session
  meowcode web [--port N]       Start the built-in WebUI front-end
  meowcode webui                Alias for \`meowcode web\`
  meowcode -p "<prompt>"        Print mode: one-shot, non-interactive
  echo "<prompt>" | meowcode    Same, reading the prompt from stdin
  meowcode <entry>              Same as --entry <entry> (shorthand)

Options:
  -p, --print <prompt>   Run a single prompt and stream the response to stdout
  -c, --continue         Resume the most recent session
      --resume [id]      Resume a saved session (the latest, or the given id)
      --fork-session [id]  Open a copy of a saved session, leaving the original intact
      --web              Start the built-in WebUI front-end
      --port <number>    Port for the WebUI (default: 4040)
      --host <host>      Host for the WebUI (default: 127.0.0.1)
      --no-open          Do not automatically open the browser in web mode
      --no-auth          WebUI: skip the token check (deliberate exposure; anyone
                        who reaches the port can drive the agent)
      --model <id>       Model to use for this run
      --provider <id>    Provider to use (mock | anthropic)
      --permission-mode <m>  Permission mode for a -p run
                             (default | acceptEdits | plan | bypassPermissions)
      --entry <name>      Start the named entry (a front-end of its own)
  -h, --help             Show this help
  -v, --version          Show the version

Entries:
  meowcode entry list                 List entries (marks default and active)
  meowcode entry new <name>           Create an entry
  meowcode entry use <name>           Set the default entry
  meowcode entry default              Print the default entry
  meowcode entry default off          Clear the default entry (global mode)
  meowcode entry install <spec>       Install an entry from npm, git or ./dir (--force)
  meowcode entry remove <name>        Remove an installed entry (--force)

Environment:
  ANTHROPIC_API_KEY      When set, the real Anthropic API is used by default
`)
}

/**
 * Print mode (`-p` / piped stdin): one prompt, one answer, no TUI. This runs the
 * SAME agent loop as a session — tools, hooks, permission gating, the project's
 * instruction files — because a `-p` run that silently lacked MEOWCODE.md (or ran
 * tools ungated) is not the same agent the user tested interactively.
 *
 * Non-interactive means no permission dialog, so the provider denies any call the
 * mode wanted confirmed; `--permission-mode` is how a script opts into autonomy.
 * Returns the process exit code: non-zero when the turn ended in an error.
 */
async function runPrint(prompt: string, config: AppConfig): Promise<number> {
  const provider = getProvider(config)
  const messages = [{ id: 'u1', role: 'user' as const, content: prompt }]
  const cwd = process.cwd()

  // Same system prompt the interactive session assembles (see useChat): agent
  // base prompt, effort/output-style directives, standing memory, the project's
  // instruction files, and any custom sub-agent catalog.
  const effortLevel = String(getSetting(config.settings, 'effort'))
  const allowWorkflows = getSetting(config.settings, 'dynamicWorkflows') !== false
  const agentCatalog = customAgentCatalog(cwd)
  const system = [
    AGENT_SYSTEM,
    effortDirective(effortLevel),
    outputStyleDirective(String(getSetting(config.settings, 'outputStyle'))),
    allowWorkflows ? workflowSizeDirective(String(getSetting(config.settings, 'dynamicWorkflowSize'))) : undefined,
    standingPreamble(),
    projectInstructionsPreamble(cwd),
    agentCatalog ? `## Custom sub-agents\nThese project-defined sub-agents are available as \`subagent_type\`:\n${agentCatalog}` : undefined,
    config.system,
  ].filter(Boolean).join('\n\n')

  // `--permission-mode` overrides the stored setting for this run only.
  const flagMode = flagValue('--permission-mode')
  if (flagMode && !isPermissionMode(flagMode)) {
    process.stderr.write(`Error: --permission-mode must be one of ${PERMISSION_MODES.join(', ')}.\n`)
    return 1
  }
  const permissionMode = flagMode || String(getSetting(config.settings, 'permissionMode') || 'default')

  const controller = new AbortController()
  const onSignal = (): void => controller.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let failed = false
  try {
    // No provider.agent (the mock provider): plain text stream, no tools.
    if (!provider.agent) {
      for await (const chunk of provider.stream(messages, { model: config.model, system, signal: controller.signal })) {
        process.stdout.write(chunk)
      }
      process.stdout.write('\n')
      return 0
    }
    for await (const ev of provider.agent(messages, {
      model: config.model,
      system,
      signal: controller.signal,
      thinkingBudget: resolveThinkingBudget(effortLevel, String(getSetting(config.settings, 'thinkingMode'))),
      retryStatusCodes: String(getSetting(config.settings, 'retryStatusCodes')),
      retryMaxAttempts: Number(getSetting(config.settings, 'retryMaxAttempts')) || undefined,
      continueAtUsageLimit: getSetting(config.settings, 'continueAtUsageLimit') === true,
      switchModelOnFlag: getSetting(config.settings, 'switchModelOnFlag') === true,
      fallbackModel: String(getSetting(config.settings, 'fallbackModel') || '') || undefined,
      dynamicWorkflows: allowWorkflows,
      artifacts: getSetting(config.settings, 'artifacts') !== false,
      rewind: false,
      // Gated like a session, but with nothing to prompt WITH: an 'ask' decision is
      // denied by the provider (and said so in the tool result), never auto-run.
      permissionMode,
      autoModeInPlan: getSetting(config.settings, 'autoModeInPlan') === true,
      permissionRules: config.permissions,
    })) {
      if (ev.type === 'text') process.stdout.write(ev.text)
      else if (ev.type === 'tool_use') process.stderr.write(`● ${ev.name}\n`)
      else if (ev.type === 'tool_result' && ev.isError) process.stderr.write(`⚠ ${String(ev.content).slice(0, 400)}\n`)
      else if (ev.type === 'error') { failed = true; process.stderr.write(`⚠ ${ev.message}\n`) }
    }
    process.stdout.write('\n')
  } catch (e) {
    failed = true
    process.stderr.write(`⚠ ${(e as Error).message}\n`)
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  // An aborted run is a failure for a script that was waiting on the answer.
  return failed || controller.signal.aborted ? 1 : 0
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').trim()
}

// Own the terminal for a stretch of raw-mode input: alternate screen, mouse
// reporting, kitty keyboard protocol, and a PassThrough that proxies the TTY
// controls Ink needs while we decode the real fd ourselves. Shared by the
// startup migration dialog and the interactive session so both get the same
// screen, the same mouse modes, and the same (unconditional) restore — see
// restore() below for why that matters. The 'exit'/signal listeners accumulate
// across calls, but restore() is idempotent, so the last one to fire is the
// only one that writes.
interface TermSession { wrapped: PassThrough; restore: () => void }

function openTermSession(): TermSession {
  process.stdout.write(ALT_ON + MOUSE_ON + KITTY_ON + CLEAR)

  // Sit a translator in front of Ink's stdin so the kitty keyboard protocol
  // (enabled above) gives us Shift/Alt+Enter as a newline while every other key
  // — including ctrl+c — still reaches Ink as the legacy byte it expects (see
  // lib/kittykeys). `wrapped` is a plain readable Ink and the mouse listener both
  // consume; we forward process.stdin through the translator into it and proxy
  // the TTY controls Ink needs (isTTY / setRawMode) back to the real stdin.
  const source = process.stdin
  const wrapped = new PassThrough() as PassThrough & {
    isTTY?: boolean
    setRawMode?: (mode: boolean) => unknown
    ref?: () => unknown
    unref?: () => unknown
  }
  wrapped.isTTY = source.isTTY
  wrapped.setRawMode = (mode: boolean) => { source.setRawMode?.(mode); return wrapped }
  wrapped.ref = () => wrapped
  wrapped.unref = () => wrapped
  const translate = createKittyTranslator((out) => { wrapped.write(out) })
  // Decode raw stdin with a persistent StringDecoder, NOT chunk.toString('utf8').
  // `source` (process.stdin, raw mode) emits Buffers with no encoding set — Ink's
  // own stdin.setEncoding runs on the downstream `wrapped` PassThrough, i.e. AFTER
  // this decode, so it can't help. A multibyte code point (3-byte CJK, 4-byte
  // emoji) that straddles a chunk boundary — common on any paste larger than the
  // pty buffer — would decode to U+FFFD (�) with per-chunk toString, silently
  // corrupting pasted Chinese/emoji. StringDecoder holds the incomplete trailing
  // bytes until the next chunk completes the sequence, so nothing is mangled.
  const decoder = new StringDecoder('utf8')
  const forward = (chunk: Buffer): void => { translate(decoder.write(chunk)) }
  source.on('data', forward)
  // Attaching 'data' resumes the stream, but it does NOT undo an unref() from a
  // previous session's restore() (the migration dialog opens and closes one
  // before this), and an unref'd TTY handle never keeps the event loop alive —
  // the process would exit before the prompt ever rendered.
  try { source.ref?.() } catch { /* ignore */ }

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    source.off('data', forward)
    // Release the REAL stdin. Ink is handed `wrapped` (whose ref/unref are no-op
    // proxies), so its unmount unref never reaches the real fd; and Node only
    // auto-pauses a stream when its last 'readable' listener is removed, not on
    // 'data' removal. Without this the raw TTY read handle stays ref'd and keeps
    // the event loop alive — the process hangs after /exit until the user ^C's.
    try { source.pause() } catch { /* ignore */ }
    try { source.unref?.() } catch { /* ignore */ }
    process.stdout.write(KITTY_OFF + MOUSE_OFF + ALT_OFF)
  }
  // Always restore the terminal, even on a crash or signal — a stuck alternate
  // screen / mouse mode would otherwise leave the user's shell unusable. 'exit'
  // covers normal completion and process.exit(); async termination signals do
  // NOT fire 'exit' on their own, so bind them too and then re-exit. We skip
  // SIGINT: in raw mode the terminal delivers ctrl+c to App as a 0x03 byte (its
  // press-twice-to-exit handler) rather than raising SIGINT, so a SIGINT handler
  // here would only shadow that without benefit.
  process.on('exit', restore)
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    process.once(sig, () => { restore(); process.exit(sig === 'SIGTERM' ? 143 : sig === 'SIGHUP' ? 129 : 131) })
  }
  return { wrapped, restore }
}

// The config a session read off disk gets adopted with. Two corrections, and
// both are load-bearing rather than belt-and-braces:
//
//   1. `apiKey` — the env-sourced key, which no session file has ever carried.
//   2. The `apiKeySetting` row — session files are written REDACTED (see
//      sessions.ts's stripCredentials), so a naive spread would hand the app a
//      bag with no key row, and the first save would call saveApiKey('') and
//      erase credentials.json. A file written before redaction existed carries a
//      STALE row instead, which would resurrect a rotated-away key over the
//      current one. withLiveKey re-resolves from credentials.json either way,
//      which is the same thing loadConfig() does.
//
// One helper for /resume, --resume, --continue and --fork-session, so no resume
// path can be the one that forgets.
function resumeConfig(stored: AppConfig): AppConfig {
  return { ...withLiveKey(stored), apiKey: process.env.ANTHROPIC_API_KEY }
}

// Interactive session. Both /clear and /compact tear down the Ink instance and
// remount a fresh one — the reliable way to reset Ink's log-update accounting
// and re-seed the transcript. /clear starts empty; /compact carries the folded
// transcript forward via a SessionSnapshot. Resize no longer remounts (the
// owned viewport reflows on a dims state change), so there is no <Static> to
// desync. We own the whole screen via the alternate buffer for the session's
// lifetime and, on a clean exit, leave the terminal tidy the way Claude Code
// does — no full-transcript dump, just a one-line closing trace (see finally).
async function runInteractive(initial: AppConfig, resume?: { snapshot: SessionSnapshot; id: string }): Promise<void> {
  let config = initial
  let snapshot: SessionSnapshot | null = resume?.snapshot ?? null
  // True only while `snapshot` came from /resume or --continue (not a /compact
  // remount), so App shows the session recap exactly once on a real reopen.
  let resumed = !!resume
  // Latest live session state, kept current by App via onSnapshot, so the exit
  // dump prints the final transcript after we leave the alternate screen.
  let last: SessionSnapshot | null = null
  // The id of the session file we autosave into. One per process, EXCEPT /clear
  // (rotates to a fresh session) and /resume (adopts the reopened session's id).
  let sessionId = resume?.id ?? newSessionId()
  // Debounce autosaves: transcripts change on every token while streaming, so we
  // coalesce writes to at most one per idle window rather than hitting the disk
  // per frame. The finally block flushes a final save on exit.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveTimer = null; if (last) saveSession(sessionId, last) }, 1500)
  }

  const { wrapped, restore } = openTermSession()

  try {
    for (;;) {
      let again = false
      const remount = (next: AppConfig, snap: SessionSnapshot | null): void => {
        config = next
        snapshot = snap
        again = true
        instance?.unmount()
        process.stdout.write(CLEAR)
      }
      // /clear: drop the transcript AND start a brand-new session file (the old one
      // stays saved on disk and is reachable via /resume).
      const onClear = (next: AppConfig): void => { sessionId = newSessionId(); last = null; resumed = false; remount(next, null) }
      // /compact: keep the (folded) transcript, remount cleanly (same session).
      const onRepaint = (snap: SessionSnapshot): void => { resumed = false; remount(snap.config, snap) }
      // /resume: reopen a saved session — adopt its id so autosaves keep updating
      // that file. The stored config carries no credential (session files are
      // written redacted), so both keys are re-injected here: the env one the
      // file never had, and the credential row from credentials.json — without
      // that second one the first settings write after a resume would call
      // saveApiKey('') and erase the user's key. See config.ts's withLiveKey.
      const onResume = (snap: SessionSnapshot, id: string): void => {
        sessionId = id
        last = null
        resumed = true
        remount(resumeConfig(snap.config), snap)
      }
      // /fork: branch the current conversation. Freeze the original session file as
      // it stands now, then rotate to a fresh id so continued work lands in a new
      // session — the original stays on disk, reopenable via /resume. No remount:
      // the live transcript carries on unchanged, only its autosave target moves.
      // Returns the new id (or null when there's no transcript saved yet to fork).
      const onFork = (): string | null => {
        if (!last) return null
        saveSession(sessionId, last) // freeze the original at the fork point
        sessionId = newSessionId()   // future autosaves target the branch
        saveSession(sessionId, last) // materialize the branch immediately
        return sessionId
      }
      const onSnapshot = (snap: SessionSnapshot): void => { last = snap; scheduleSave() }
      // App owns ctrl+c (interrupt / press-twice-to-exit), so keep Ink from
      // exiting on the first ctrl+c itself.
      const instance = render(
        <App config={config} initial={snapshot} resumed={resumed} sessionId={sessionId} onClear={onClear} onRepaint={onRepaint} onSnapshot={onSnapshot} onResume={onResume} onFork={onFork} />,
        { exitOnCtrlC: false, stdin: wrapped as unknown as NodeJS.ReadStream },
      )
      await instance.waitUntilExit()
      if (!again) break
    }
  } finally {
    if (saveTimer) clearTimeout(saveTimer)
    if (last) saveSession(sessionId, last) // flush a final autosave before we leave
    restore()
    // Clean exit, the way Claude Code leaves the terminal: leaving the alternate
    // screen already restored the pre-launch terminal, so we do NOT re-dump the
    // whole transcript into the normal buffer — that just leaves clutter behind
    // ("退出后残留"). We print a single closing line as a trace the session ran.
    const snap = last as SessionSnapshot | null
    const n = snap ? snap.messages.filter((m) => m.content !== '__banner__' && m.content.trim()).length : 0
    if (n > 0) {
      process.stdout.write(`\n${NAME} session ended · ${n} message${n === 1 ? '' : 's'}. Run \`meowcode\` to start again.\n`)
    }
  }
  // Belt-and-suspenders: the finally above already flushed the final autosave and
  // restored the terminal synchronously, so force the process to exit. This defends
  // against any lingering handle (a still-running /monitor or background-shell child,
  // a scheduled timer) that would otherwise keep the event loop alive and wedge the
  // user's shell until they hit ctrl+c.
  process.exit(0)
}

// `meowcode entry ...` — non-interactive entry (front-end) management. Runs and
// exits before any interactive mount. Markers: ● on the default, ▶ on the
// active entry of this process (only meaningful under `entry list` invoked
// with --entry, kept for completeness), [builtin] on the built-in TUI.
function runEntryCommand(args: string[]): void {
  const sub = args[0] ?? 'list'
  if (sub === 'list' || sub === 'ls') {
    const entries = listEntries()
    const def = getDefaultEntry()
    if (entries.length === 0) { process.stdout.write('No entries yet (create one with `meowcode entry new <name>`).\n'); return }
    for (const e of entries) {
      const marks = [e.name === def ? '●' : null, e.name === activeEntryName() ? '▶' : null, e.builtin ? '[builtin]' : null, e.hasLauncher ? '[launcher]' : null].filter(Boolean).join(' ')
      const desc = e.description ? ` — ${e.description}` : ''
      process.stdout.write(`${marks ? marks.padEnd(2) : ' '} ${e.name}${desc}\n`)
    }
    return
  }
  if (sub === 'new' || sub === 'create') {
    // An entry is a complete front-end shipped by a plugin — hand-authoring one
    // would leave an entry with no UI behind it. Installing is the only way in.
    process.stderr.write(
      'Error: entries cannot be created by hand — they are front-ends shipped by plugins.\n' +
      'Install one instead: meowcode entry install <npm-package | git-url | ./dir>\n',
    )
    process.exit(1)
  }
  if (sub === 'use' || sub === 'default') {
    // `meowcode entry default` prints the current default; `entry default off`
    // (or `entry use off`) clears it back to global mode.
    const target = args[1]
    if (target === undefined) {
      const def = getDefaultEntry()
      process.stdout.write(def ? `${def}\n` : 'none\n')
      return
    }
    if (target === 'off') { setDefaultEntry(null); process.stdout.write('Default entry cleared (global mode).\n'); return }
    if (!entryExists(target)) {
      process.stderr.write(`Error: entry '${target}' does not exist (see 'meowcode entry list').\n`)
      process.exit(1)
    }
    setDefaultEntry(target)
    process.stdout.write(`Default entry set to '${target}'.\n`)
    return
  }
  if (sub === 'install' || sub === 'remove') {
    // install/remove parse --force and the operand in lib/entryInstall so this
    // stays a thin try/catch: one-line success to stdout, one-line error + 1.
    try {
      process.stdout.write(entryInstallCommand(sub, args.slice(1)) + '\n')
    } catch (err) {
      if (!(err instanceof EntryInstallError)) throw err // a real bug — let main's catch show the stack
      process.stderr.write(`Error: ${err.message}\n`)
      process.exit(1)
    }
    return
  }
  process.stderr.write(`Usage: meowcode entry list|install <source>|use <name>|default [off]|remove <name>\n`)
  process.exit(1)
}

// The one-time ~/.anycode → ~/.meowcode question, as an Ink dialog. It runs in
// its own short-lived Ink instance on the alternate screen — the same mode the
// session owns — so the question starts at screen row 1 (which is what the
// dialog's mouse hit-test assumes), Ink owns every pixel while it is up, and
// leaving the buffer hands the user's shell back untouched. The one-line result
// is written by the caller, after we're back on the normal screen.
async function askLegacyDir(info: LegacyDirInfo): Promise<LegacyChoice> {
  // Same palette/language the TUI would use, so the dialog doesn't flash a
  // different theme than the session that follows it.
  const boot = loadConfig()
  const colors = getTheme(boot.theme).colors
  const lang = resolveLang(getSetting(boot.settings, 'language') as string)
  const { wrapped, restore } = openTermSession()

  return new Promise<LegacyChoice>((resolve) => {
    let settled = false
    // Declared as a hoisted function so the JSX below can hand it to the dialog
    //; it only runs after render() returned, so `instance` is bound by then.
    function finish(choice: LegacyChoice): void {
      if (settled) return
      settled = true
      // Give the terminal back FIRST (the restore also drops mouse tracking, the
      // kitty protocol, and the alternate buffer), then resolve so the report is
      // written onto the normal screen rather than a buffer we're leaving.
      instance.unmount()
      restore()
      resolve(choice)
    }
    const instance = render(
      <ThemeProvider value={colors}>
        <LangProvider value={lang}>
          <LegacyDirDialog info={info} dest={CONFIG_DIR} onDone={finish} />
        </LangProvider>
      </ThemeProvider>,
      { exitOnCtrlC: true, stdin: wrapped as unknown as NodeJS.ReadStream },
    )
    // Ctrl+C (exitOnCtrlC) or a closed stdin tears Ink down with no answer;
    // treat that as "skip" rather than hanging — the same degradation the old
    // readline prompt had.
    void instance.waitUntilExit().then(() => finish('skip'))
  })
}

async function main(): Promise<void> {
  if (has('-h', '--help')) { printHelp(); return }
  if (has('-v', '--version')) { process.stdout.write(VERSION + '\n'); return }

  // WebUI command / --web flag: start the built-in WebUI server
  if (argv[0] === 'web' || argv[0] === 'webui' || has('--web')) {
    const portVal = flagValue('--port')
    const hostVal = flagValue('--host')
    const port = portVal ? parseInt(portVal, 10) : 4040
    const host = hostVal || '127.0.0.1'
    const openBrowser = !has('--no-open')
    const noAuth = has('--no-auth')
    const config = loadConfig()
    const model = flagValue('--model')
    if (model) config.model = model
    const provider = flagValue('--provider')
    if (provider) config.provider = provider

    process.stdout.write('Starting MeowCode Built-in WebUI...\n')
    const { startWebUI } = await import('./webui')
    // cwd: every tool the agent runs in the browser resolves against this, so it
    // must be the directory the user launched from — not a later default.
    const instance = await startWebUI({ port, host, openBrowser, auth: !noAuth, config, cwd: process.cwd() })
    process.stdout.write(`\n🐾 MeowCode WebUI listening at: ${instance.baseUrl}\n`)
    process.stdout.write(`• Extension slots active: header, sidebar, chat, message, panels, statusbar\n`)
    process.stdout.write(`• Browser SDK: window.MeowSDK\n`)
    process.stdout.write(`• Built-in showcase plugins: Workspace Files, Tools Inspector, Prompt Templates, Metrics Monitor\n`)
    process.stdout.write(`Press Ctrl+C to terminate.\n\n`)
    return
  }

  // Language + palette for the migration dialog below. Read straight off disk
  // rather than through loadConfig(): this runs before the entry is resolved,
  // and asking a Chinese user a question in English (or the reverse) is exactly
  // the kind of thing a migration notice should not do. setLang() syncs the
  // module-level mirror so the post-answer report speaks the same language.
  const bootCfg = loadConfig()
  setLang(resolveLang(getSetting(bootCfg.settings, 'language') as string))

  // Legacy config-dir migration: this build reads ~/.meowcode only, so a user
  // upgrading from the AnyCode era would silently start with an empty history.
  // Ask BEFORE the entry is resolved and before the TUI mounts — the dialog runs
  // in its own short-lived Ink session (own terminal modes, own stdin wrapper),
  // then hands control back. No-op when there's no old dir or ~/.meowcode
  // already has state; print mode / pipes get the stderr notice instead.
  const outcome = await offerLegacyMigration(askLegacyDir)
  if (outcome.merged) reportMergeOutcome(outcome)

  // The built-in TUI is a real entry, so materialize it before anything reads
  // the entry list or resolves a default: that makes `meowcode tui` (the argv
  // shorthand below) work on a fresh install, and makes `tui` show up as row 1
  // of `/entry` next to the plugin entries. Idempotent and never clobbers an
  // existing entries/tui/.
  materializeBuiltinEntry()

  // Entry resolution, before anything config-touching: an explicit --entry wins;
  // else the persisted default; else global mode — which reads and writes exactly
  // the files the built-in `tui` entry does, so "no default" means "start the TUI".
  // A positional shorthand `meowcode <name>` activates when argv[0] is an
  // existing entry name (and is then removed so it isn't parsed as anything else).
  if (argv[0] === 'entry') { runEntryCommand(argv.slice(1)); return }
  if (argv[0] && !argv[0].startsWith('-') && entryExists(argv[0])) {
    const shorthand = argv.shift() ?? null
    activateEntry(shorthand)
  } else {
    const entryFlag = flagValue('--entry')
    if (entryFlag === '') {
      // --entry present but no usable value
      process.stderr.write('Error: --entry requires a name (see `meowcode entry list`).\n')
      process.exit(1)
    }
    const name = entryFlag !== undefined && entryFlag !== '' ? entryFlag : getDefaultEntry()
    if (name) {
      if (!entryExists(name)) {
        process.stderr.write(`Error: entry '${name}' does not exist (see 'meowcode entry list').\n`)
        process.exit(1)
      }
      activateEntry(name)
    } else {
      activateEntry(null)
    }
  }

  let config = loadConfig()
  const model = flagValue('--model')
  if (model) config.model = model
  const provider = flagValue('--provider')
  if (provider) config.provider = provider

  // Launcher front-end: an entry that declares "launcher" (a webui, a tray app,
  // any non-TUI surface) takes over the process here — the Ink TUI never
  // mounts. With no launcher, MeowCode itself IS the TUI (the default entry).
  const launcher = activeEntry() ? readLauncherConfig(activeEntry()!.dir) : null
  if (launcher && !has('-p', '--print')) {
    await runLauncher(launcher, config)
    return
  }

  if (has('-p', '--print')) {
    const prompt = flagValue('-p', '--print')
    if (!prompt) {
      process.stderr.write('Error: -p/--print requires a prompt argument.\n')
      process.exit(1)
    }
    process.exitCode = await runPrint(prompt, config)
    return
  }

  if (!process.stdin.isTTY) {
    const piped = await readStdin()
    if (piped) { process.exitCode = await runPrint(piped, config); return }
    process.stderr.write(
      'Error: no prompt provided and stdin is not a TTY.\n' +
      'Use `meowcode -p "<prompt>"`, pipe a prompt in, or start `meowcode` in an interactive terminal.\n',
    )
    process.exit(1)
  }

  // Session resume: `--continue`/`-c` reopens the most recent session; `--resume
  // [id]` reopens a specific one (or the latest when no id is given). The stored
  // config drives the reopened session (model/theme/settings), with the API key
  // re-injected from the environment since it's never written to disk.
  let resume: { snapshot: SessionSnapshot; id: string } | undefined
  if (has('--fork-session')) {
    // `--fork-session [id]` opens a COPY of a saved session (the latest when no id
    // is given) under a fresh id, leaving the original untouched — a branch point
    // straight from launch, symmetric with `--resume`.
    const wanted = flagValue('--fork-session')
    const srcId = wanted || latestSession()?.id
    const forkedId = srcId ? forkSession(srcId) : null
    const snap = forkedId ? loadSession(forkedId) : null
    if (forkedId && snap) {
      resume = { snapshot: snap, id: forkedId }
      config = resumeConfig(snap.config)
      if (model) config.model = model
      if (provider) config.provider = provider
    } else {
      process.stderr.write('No saved session to fork.\n')
    }
  } else if (has('-c', '--continue', '--resume')) {
    const wanted = flagValue('--resume')
    const id = wanted || latestSession()?.id
    const snap = id ? loadSession(id) : null
    if (id && snap) {
      resume = { snapshot: snap, id }
      config = resumeConfig(snap.config)
      if (model) config.model = model
      if (provider) config.provider = provider
    } else {
      process.stderr.write('No saved session to resume.\n')
    }
  }

  await runInteractive(config, resume)
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n')
  process.exit(1)
})
