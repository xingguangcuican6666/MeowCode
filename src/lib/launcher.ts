// Launcher bridge — the host side of "entry plugins that change how MeowCode
// starts" (the dsh TUI-vs-web split, condensed to our scale). An entry's
// entry.json may declare
//
//   "launcher": { "command": "node", "args": ["launcher.js"], "cwd": "..." }
//
// When such an entry is active, `meowcode` skips the Ink TUI entirely and hands
// the front-end to this child process over the MCP-style newline-delimited
// JSON-RPC 2.0 stdio transport lib/mcp.ts already established for servers —
// same framing, our own methods. The plugin is the CLIENT; MeowCode is the
// server (the reverse of MCP, because here the plugin drives the agent):
//
//   → agent/turn    { prompt }   run ONE full agent turn (tool loop included);
//                                resolves with { turn, done } when the model
//                                stops, streaming progress via notifications
//     ← agent/event { turn, event }  one AgentEvent of that turn
//   → agent/abort   {}           abort the in-flight turn (the TUI's esc);
//                                { aborted }, no error when nothing runs
//   → tools/list    {}           Anthropic-format tool schemas
//   → tools/call    { name, input } run one tool, returns the ToolResult
//   → config/get    {}           the effective AppConfig, credentials stripped
//   → session/state {}           messages + usage of the host session
//   → session/reset {}           drop the transcript (like /clear), fresh id
//
// Session state lives HERE, not in the plugin, so a webui stays stateless while
// its transcript still lands in the entry's sessions/ (same dir saveSession
// uses, byte-for-byte the same record). The host transcript records exactly
// what useChat records — user prompts, assistant replies, 'tool' rows for tool
// use/results — so the file is /resume-compatible.
//
// Two deliberate cuts keep this host small and honest:
// - Interactive permission prompts don't exist headlessly: agent turns run in
//   'bypassPermissions' (the plugin owns interaction and can gate before
//   calling agent/turn). The entry's `permissions` deny/allow rules are still
//   threaded in as permissionRules, so entry-level policy binds the model.
// - Hooks fire only when the ENTRY brings them (loadHooks reads the same
//   layered configs the TUI reads); there is no user to answer ask_user, so
//   requestUserInput is absent and the tool reports that on its own.
import type { ChildProcess } from 'node:child_process'
import { spawnFile, killTree } from './shell'
import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import { getProvider } from '../providers'
import { runTool, toolSchemas, summarizeToolCall } from '../tools'
import { newSessionId, saveSession } from './sessions'
import { redactSettings } from './credentials'
import type { AgentEvent, AgentSnapshot, AppConfig, Message, SessionUsage, WorkflowSnapshot } from '../types'
import type { ToolContext } from '../tools/types'
import { AGENT_SYSTEM, formatToolResult } from '../hooks/chat-helpers'
import { standingPreamble } from './memory'
import { projectInstructionsPreamble } from './projectInstructions'
import { customAgentCatalog } from '../tools/orchestration'
import { runHooks } from './hooks'
import { getSetting, effortDirective, outputStyleDirective, workflowSizeDirective, resolveThinkingBudget } from './settings'
import { emptyUsage } from './usage'
import { changeSummary } from './transcript'
import { entryAwareSaveConfig } from './entries'
import { startMcpServers, stopMcpServers } from './mcp'
import { NAME, VERSION } from '../version'

export interface LauncherConfig {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 600_000 // an agent turn can legitimately run long

export class LauncherError extends Error {}

// ---- JSON-RPC server over the launcher child's stdio -----------------------

export interface LauncherSession {
  child: ChildProcess
  nextId: number
  pending: Map<number, Pending>
}

// A one-way event toward the plugin (no id, no reply).
function notify(l: LauncherSession, method: string, params?: unknown): void {
  l.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

// An outbound host→plugin request (used once, for the handshake).
function request(l: LauncherSession, method: string, params?: unknown): Promise<any> {
  const id = l.nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.pending.delete(id)
      reject(new LauncherError(`launcher request timed out: ${method}`))
    }, REQUEST_TIMEOUT_MS)
    l.pending.set(id, { resolve, reject, timer })
    l.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (err) => {
      if (err) { clearTimeout(timer); l.pending.delete(id); reject(err) }
    })
  })
}

// Reply to an inbound plugin request.
function replyTo(l: LauncherSession, id: number, result: unknown): void {
  l.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function replyError(l: LauncherSession, id: number, message: string): void {
  l.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n')
}

/** Fail every in-flight request, because the pipe they are waiting on is gone. */
function rejectPending(l: LauncherSession, why: string): void {
  for (const [, p] of l.pending) {
    // The timer too: a cleared map with 600-second timers still holding the event
    // loop open is the same hang by another route.
    clearTimeout(p.timer)
    p.reject(new LauncherError(why))
  }
  l.pending.clear()
}

// One inbound line: a response (has id) resolves a pending host request; a
// request (has method) is the plugin calling into the host. Errors come back
// as JSON-RPC errors, never as throws, so one bad call can't take the bridge
// down.
async function handleLine(l: LauncherSession, st: LauncherState, line: string): Promise<void> {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg: any
  try { msg = JSON.parse(trimmed) } catch { return }
  if (msg && typeof msg.id === 'number' && l.pending.has(msg.id)) {
    const p = l.pending.get(msg.id)!
    l.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new LauncherError(msg.error.message || 'launcher error'))
    else p.resolve(msg.result)
    return
  }
  if (!msg || typeof msg.method !== 'string') return
  const id = typeof msg.id === 'number' ? msg.id : null
  try {
    const result = await dispatch(l, st, msg.method, msg.params ?? {})
    if (id !== null) replyTo(l, id, result)
  } catch (e) {
    if (id !== null) replyError(l, id, e instanceof Error ? e.message : String(e))
  }
}

// ---- Host state + method dispatch ------------------------------------------

// The transcript + session bookkeeping the plugin drives. Intentionally the
// same fields /resume replays: config, messages, usage — autosaved with
// saveSession into the entry's sessions dir on the same debounce as the TUI.
interface LauncherState {
  config: AppConfig
  sessionId: string
  messages: Message[]
  usage: SessionUsage
  saveTimer: ReturnType<typeof setTimeout> | null
  // SessionStart hook context, resolved lazily on the first real turn (same as
  // useChat: once per process, folded into every turn's system prompt).
  hookCtx?: string
  turnSeq: number
  controller: AbortController | null
}

function buildSystem(st: LauncherState): string {
  const preamble = standingPreamble()
  const projInstr = projectInstructionsPreamble(process.cwd())
  const agentCatalog = customAgentCatalog(process.cwd())
  const agentsPreamble = agentCatalog
    ? `## Custom sub-agents\nBesides the built-in roles (general, explore, code, plan), these project-defined sub-agents are available as \`subagent_type\` for the task/workflow tools:\n${agentCatalog}`
    : undefined
  const effortLevel = String(getSetting(st.config.settings, 'effort'))
  return [
    AGENT_SYSTEM,
    effortDirective(effortLevel),
    outputStyleDirective(String(getSetting(st.config.settings, 'outputStyle'))),
    workflowSizeDirective(String(getSetting(st.config.settings, 'dynamicWorkflows') !== false ? getSetting(st.config.settings, 'dynamicWorkflowSize') : undefined)),
    preamble,
    projInstr,
    agentsPreamble,
    st.hookCtx,
    st.config.system,
  ].filter(Boolean).join('\n\n')
}

function scheduleSave(st: LauncherState): void {
  if (st.saveTimer) clearTimeout(st.saveTimer)
  st.saveTimer = setTimeout(() => {
    st.saveTimer = null
    saveSession(st.sessionId, {
      config: st.config, messages: st.messages,
      goal: null, loop: null, usage: st.usage,
    })
  }, 1500)
}

// The headless twin of useChat's submit(): commit the user turn, stream one full
// agent turn into the host transcript, commit answer + error rows exactly the
// way the hook does (thinking blocks flagged, tool rows as role 'tool', a ⚠
// system row on terminal error — all of them toApiMessages-compatible), then
// push each AgentEvent to the plugin as agent/event. One turn at a time: a
// second agent/turn while one streams is rejected, like the TUI's submit guard.
async function runTurn(l: LauncherSession, st: LauncherState, prompt: string): Promise<{ turn: number }> {
  if (!prompt.trim()) throw new LauncherError('agent/turn requires a non-empty prompt')
  if (st.controller) throw new LauncherError('a turn is already streaming (one turn at a time)')
  const cwd = process.cwd()
  if (st.hookCtx === undefined) {
    const ss = await runHooks('SessionStart', { source: 'startup' }, cwd)
    st.hookCtx = ss.context || ''
    if (ss.systemMessage) st.messages = [...st.messages, { id: 'hook-ss', role: 'system', content: ss.systemMessage }]
  }
  const ups = await runHooks('UserPromptSubmit', { prompt }, cwd)
  if (ups.systemMessage) st.messages = [...st.messages, { id: 'hook-ups', role: 'system', content: ups.systemMessage }]
  if (ups.decision === 'deny' || ups.stop) {
    st.messages = [...st.messages, { id: 'hook-block', role: 'system', content: `Prompt blocked: ${ups.reason ?? ''}`, meta: { error: true } }]
    scheduleSave(st)
    return { turn: st.turnSeq }
  }
  const turn = ++st.turnSeq
  const userMsg: Message = { id: `u${turn}`, role: 'user', content: prompt, meta: { ts: Date.now() } }
  const hookContext = ups.context || ''
  if (hookContext) userMsg.meta = { ...userMsg.meta, injectedContext: hookContext }
  st.messages = [...st.messages, userMsg]

  const cfg = st.config
  const configSnapshot = cfg
  const provider = getProvider(cfg)
  const effortLevel = String(getSetting(cfg.settings, 'effort'))
  const thinkingMode = String(getSetting(cfg.settings, 'thinkingMode'))
  const assistantId = `a${turn}`
  let acc = ''
  let thinkingAcc = ''
  let errorMsg = ''
  const turnStart = Date.now()
  const t = { input: 0, output: 0 }
  const controller = new AbortController()
  st.controller = controller
  try {
    // No provider.agent → plain-text chat fallback (mirrors the hook's else branch).
    if (!provider.agent) {
      for await (const chunk of provider.stream(st.messages, { model: cfg.model, system: buildSystem(st), signal: controller.signal })) {
        acc += chunk
        notify(l, 'agent/event', { turn, event: { type: 'text', text: chunk } satisfies AgentEvent })
      }
    } else {
      for await (const ev of provider.agent(st.messages, {
        model: cfg.model,
        system: buildSystem(st),
        signal: controller.signal,
        thinkingBudget: resolveThinkingBudget(effortLevel, thinkingMode),
        retryStatusCodes: String(getSetting(cfg.settings, 'retryStatusCodes')),
        retryMaxAttempts: Number(getSetting(cfg.settings, 'retryMaxAttempts')) || undefined,
        continueAtUsageLimit: getSetting(cfg.settings, 'continueAtUsageLimit') === true,
        switchModelOnFlag: getSetting(cfg.settings, 'switchModelOnFlag') === true,
        fallbackModel: String(getSetting(cfg.settings, 'fallbackModel') || '') || undefined,
        dynamicWorkflows: getSetting(cfg.settings, 'dynamicWorkflows') !== false,
        artifacts: getSetting(cfg.settings, 'artifacts') !== false,
        rewind: getSetting(cfg.settings, 'rewindCode') !== false,
        // No interactive user on this side: an 'ask' decision falls through to
        // allow (the plugin gates before calling). Deny rules still bind via
        // permissionRules, so entry-level policy is never bypassed.
        permissionMode: 'bypassPermissions',
        permissionRules: configSnapshot.permissions,
        onPermissionModeChange: (mode: string) => {
          st.config = { ...st.config, settings: { ...(st.config.settings ?? {}), permissionMode: mode } }
          entryAwareSaveConfig(st.config) // persist like /permissions would
        },
        onWorkflow: (snap: WorkflowSnapshot) => notify(l, 'agent/event', { turn, event: { type: 'workflow', snap } as unknown as AgentEvent }),
        onAgent: (snap: AgentSnapshot) => notify(l, 'agent/event', { turn, event: { type: 'agent', snap } as unknown as AgentEvent }),
      })) {
        if (ev.type === 'thinking') { thinkingAcc += ev.text }
        else if (ev.type === 'text') { acc += ev.text }
        else if (ev.type === 'tool_use') {
          if (thinkingAcc.trim()) { st.messages = [...st.messages, { id: `${assistantId}-t`, role: 'assistant', content: thinkingAcc, meta: { thinking: true } }]; thinkingAcc = '' }
          if (acc.trim()) { st.messages = [...st.messages, { id: assistantId, role: 'assistant', content: acc }]; acc = '' }
          st.usage.toolCalls++
          st.messages = [...st.messages, { id: ev.id, role: 'tool', content: `● ${summarizeToolCall(ev.name, ev.input)}` }]
        } else if (ev.type === 'tool_result') {
          if (ev.linesAdded) st.usage.linesAdded += ev.linesAdded
          if (ev.linesRemoved) st.usage.linesRemoved += ev.linesRemoved
          st.messages = [...st.messages, ev.diff?.length && !ev.isError
            ? { id: `${ev.id}-r`, role: 'tool', content: `⎿ ${changeSummary(ev.linesAdded ?? 0, ev.linesRemoved ?? 0)}`, meta: { diff: ev.diff } }
            : { id: `${ev.id}-r`, role: 'tool', content: formatToolResult(ev.display ?? ev.content, ev.isError), meta: ev.isError ? { error: true } : undefined }]
        } else if (ev.type === 'usage') { t.input += ev.inputTokens; t.output += ev.outputTokens }
        else if (ev.type === 'error') { errorMsg = ev.message }
        notify(l, 'agent/event', { turn, event: ev })
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) errorMsg = (err as Error)?.message ?? String(err)
  } finally {
    st.controller = null
  }
  if (thinkingAcc.trim()) st.messages = [...st.messages, { id: `${assistantId}-t`, role: 'assistant', content: thinkingAcc, meta: { thinking: true } }]
  // Same commit rule as useChat: an interrupted turn still commits whatever text
  // arrived, flagged `interrupted` — a plugin redrawing from session/state has to
  // be able to tell "the model stopped here" from "the model finished here", and
  // an abort that lands before the first token must still leave a row.
  const interrupted = controller.signal.aborted
  if (acc.trim() || interrupted) {
    st.messages = [...st.messages, { id: assistantId, role: 'assistant', content: acc, meta: interrupted ? { interrupted: true } : undefined }]
  }
  if (errorMsg && !interrupted) {
    st.messages = [...st.messages, { id: `e${turn}`, role: 'system', content: `⚠ ${errorMsg}`, meta: { error: true } }]
  }
  st.usage.turns++
  st.usage.inputTokens += t.input
  st.usage.outputTokens += t.output
  st.usage.apiMs += Date.now() - turnStart
  scheduleSave(st)
  return { turn }
}

async function dispatch(l: LauncherSession, st: LauncherState, method: string, params: any): Promise<unknown> {
  switch (method) {
    case 'config/get': {
      // Two secrets, two reasons, both gone: `apiKey` is env-sourced and never
      // leaves the host process, and the `apiKeySetting` row is the hand-typed
      // key (config.ts resolves it into the in-memory bag). The row is DELETED
      // rather than masked — see redactSettings — because a plugin holding this
      // config can hand it back to setConfig, and a placeholder there would
      // overwrite the real key with the literal string 'set'.
      const { apiKey: _omit, ...safe } = st.config
      return { ...safe, settings: redactSettings(safe.settings) }
    }
    case 'session/state':
      return { sessionId: st.sessionId, messages: st.messages, usage: st.usage }
    case 'session/reset': {
      if (st.controller) st.controller.abort()
      st.messages = []
      st.sessionId = newSessionId()
      st.usage = emptyUsage()
      return { sessionId: st.sessionId }
    }
    case 'tools/list':
      return { tools: toolSchemas(true, st.config.settings?.dynamicWorkflows !== false, process.cwd()) }
    case 'tools/call': {
      const name = String(params?.name ?? '')
      const input = (params?.input ?? {}) as Record<string, unknown>
      const ctx: ToolContext = { cwd: process.cwd(), rewind: getSetting(st.config.settings, 'rewindCode') !== false }
      return await runTool(name, input, ctx)
    }
    case 'agent/turn':
      return await runTurn(l, st, String(params?.prompt ?? ''))
    case 'agent/abort':
      // The headless twin of the TUI's esc: abort the in-flight turn and change
      // nothing else. No turn running is not an error — a stop button pressed
      // after the turn already ended should not blow up in the plugin's face, so
      // this reports `aborted: false` rather than throwing. The pending
      // agent/turn still resolves normally ({ turn }) with the partial answer
      // committed as `interrupted`, so a plugin needs no abort event to know
      // when it is over.
      if (!st.controller) return { aborted: false }
      st.controller.abort()
      return { aborted: true }
    default:
      throw new LauncherError(`unknown method: ${method}`)
  }
}

// ---- Entry point -----------------------------------------------------------

// Read the launcher declaration from the active entry's manifest. resolvePath:
// cwd defaults to the ENTRY dir (not the session cwd), so a front-end that only
// ever names its own files needs no absolute paths and no fixture rewriting.
//
// Relative `command`/`args` are anchored to the entry dir — the entry installer's
// copies land there, so that is the only directory where they can resolve — while a
// relative `cwd` is deliberately left as written, because spawn resolves it against
// the *parent's* cwd, which is the session directory. Those two rules together are
// what let one manifest say `"cwd": "."` and still be relocatable: the plugin gets
// the session's workspace as process.cwd() and finds its own files beside it.
export function readLauncherConfig(dir: string): LauncherConfig | null {
  let raw: { launcher?: LauncherConfig }
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'entry.json'), 'utf8')) as { launcher?: LauncherConfig }
  } catch { return null }
  const lc = raw.launcher
  if (!lc || typeof lc.command !== 'string' || !lc.command) return null
  // Only strings the entry actually ships get rewritten. That keeps a bare
  // command name (`node`, `deno`, `bun`) on PATH instead of turning it into
  // `<entry>/node`, and leaves any other relative argument resolving against the
  // cwd exactly as it did before — this widens what a manifest can express, it
  // does not redefine what the old ones meant.
  const anchor = (s: string): string => {
    if (!s || path.isAbsolute(s) || s.startsWith('~')) return s
    try {
      if (fs.statSync(path.join(dir, s)).isFile()) return path.join(dir, s)
    } catch { /* not a file the entry ships */ }
    return s
  }
  const args = Array.isArray(lc.args) ? lc.args.map(anchor) : []
  return { command: anchor(lc.command), args, cwd: lc.cwd ?? dir, ...(lc.env ? { env: lc.env } : {}) }
}

// Run the launcher front-end until the child exits. The child inherits the real
// stdio pipes EXCEPT its stdin/stdout, which carry JSON-RPC — a console-less
// plugin (webui: a browser tab) renders its own way and exits when the user is
// done; the final autosave lands the transcript in sessions/ either way.
export async function runLauncher(cfg: LauncherConfig, config: AppConfig): Promise<number> {
  // A tracked process-group leader (lib/shell): a launcher that forks its own
  // server — the webui does exactly this — leaves orphans behind when only the
  // direct child is signalled, and those orphans keep the port bound.
  const child = spawnFile(cfg.command, cfg.args ?? [], {
    cwd: cfg.cwd || process.cwd(),
    env: { ...process.env, ...(cfg.env ?? {}) } as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const session: LauncherSession = { child, nextId: 1, pending: new Map() }
  const st: LauncherState = {
    config, sessionId: newSessionId(), messages: [], usage: emptyUsage(),
    saveTimer: null, turnSeq: 0, controller: null,
  }
  const rl = readline.createInterface({ input: child.stdout! })
  rl.on('line', (line) => { void handleLine(session, st, line) })
  // MCP servers start here, not in app.tsx (the TUI never mounts in launcher
  // mode). Same call the TUI makes — spawned once, tools surface on the next
  // turn. Entry-relative args were already anchored by applyEntryOverrides.
  startMcpServers(process.cwd())

  // The child exiting is the end of the conversation, whatever we were waiting for.
  //
  // Without this the handshake below is what a failed launch waits on, and it waits
  // for REQUEST_TIMEOUT_MS — ten minutes — because nothing on the pending side ever
  // hears about the death. The write into the child's stdin succeeds (it lands in a
  // pipe whose reader end is already gone; the callback reports no error, since a
  // pipe accepts bytes until it doesn't), no reply is ever read, and `exited` — the
  // promise that WOULD have resolved in 40ms — is not awaited until the handshake
  // gives up. Measured: a launcher that exits 1 at startup leaves the host spinning
  // in epoll for the full timeout, holding the terminal, with a plausible-looking
  // error on screen. That is a real class of failure, not a hypothetical one — the
  // webui prints exactly this and exits 1 whenever its port is taken.
  const exited = new Promise<number>((resolve) => {
    const finish = (code: number) => {
      rejectPending(session, 'the launcher exited before answering')
      resolve(code)
    }
    child.on('exit', (code) => finish(code ?? 1))
    child.on('error', (e) => {
      process.stderr.write(`launcher failed: ${e.message}\n`)
      finish(1)
    })
  })

  // Handshake: announce the host so the plugin can version itself against it.
  try {
    await request(session, 'initialize', {
      protocolVersion: '2025-meowcode-launcher-1',
      serverInfo: { name: NAME, version: VERSION },
    })
  } catch (e) {
    process.stderr.write(`launcher handshake failed: ${e instanceof Error ? e.message : e}\n`)
    killTree(child, 'SIGTERM')
    // Escalate if the tree ignores SIGTERM, so a wedged launcher can't hold the
    // terminal open after we've given up on it.
    setTimeout(() => killTree(child, 'SIGKILL'), 2000).unref()
  }

  const code = await exited
  if (st.saveTimer) clearTimeout(st.saveTimer)
  stopMcpServers()
  saveSession(st.sessionId, { config: st.config, messages: st.messages, goal: null, loop: null, usage: st.usage })
  if (code !== 0) process.exit(code)
  return code
}
