import { getProvider } from '../providers'
// `isCommand` is the TUI's own test for "this line is a slash command", imported
// rather than re-implemented so the two queues cannot disagree about which lines
// are commands. commands/index.ts reaches webui only through a *dynamic* import
// (the /web command body), so this static edge is not a cycle.
import { isCommand } from '../commands'
import { runTool, toolSchemas, summarizeToolCall } from '../tools'
import { decidePermission, isPermissionMode, matchPermissionRule, DENY_RULE_REASON } from '../tools/permission'
import { newSessionId, saveSession, loadSession, listSessions, deleteSession, renameSession, type SessionMeta } from '../lib/sessions'
import { withLiveKey } from '../config'
import type {
  AgentEvent,
  AgentSnapshot,
  AppConfig,
  Message,
  PermissionRequest,
  SessionUsage,
  UserInputRequest,
  UserInputResponse,
  UserQuestion,
  WorkflowSnapshot,
} from '../types'
import type { ToolContext } from '../tools/types'
import { AGENT_SYSTEM, formatToolResult } from '../hooks/chat-helpers'
import { standingPreamble } from '../lib/memory'
import { projectInstructionsPreamble } from '../lib/projectInstructions'
import { customAgentCatalog } from '../tools/orchestration'
import { runHooks } from '../lib/hooks'
import { getSetting, effortDirective, outputStyleDirective, workflowSizeDirective, resolveThinkingBudget, type SettingValue } from '../lib/settings'
import { emptyUsage } from '../lib/usage'
import { redactSettings } from '../lib/credentials'
import { estimateTokens } from '../lib/tokens'
import { computeCost } from '../lib/pricing'
import { changeSummary } from '../lib/transcript'
import { startMcpServers, stopMcpServers } from '../lib/mcp'
import { entryAwareSaveConfig } from '../lib/entries'

export interface AgentBridgeState {
  sessionId: string
  messages: Message[]
  usage: SessionUsage
  isRunning: boolean
  turnSeq: number
}

/**
 * A question the running turn needs the browser to answer. The bridge has no UI of
 * its own, so it hands these to whoever installed an interaction handler (the
 * server, which pushes them over SSE and waits for the POST that answers them).
 * This is the WebUI counterpart of the TUI's PermissionDialog / AskUserDialog.
 */
export type WebUIInteraction =
  | { kind: 'permission'; id: string; tool: string; input: Record<string, unknown>; summary: string }
  | { kind: 'userInput'; id: string; questions: UserQuestion[] }

export type WebUIInteractionResponse =
  | { decision: 'allow' | 'deny'; reason?: string }
  | { answers: string[][]; cancelled?: boolean }

export type WebUIInteractionHandler = ((
  req: WebUIInteraction,
) => Promise<WebUIInteractionResponse>) & WebUIInteractionObserver

/**
 * Told when a parked prompt stops being parked for reasons other than an answer:
 * the turn timed it out, aborted it, or failed while waiting. A property on the
 * handler (rather than a second argument) so every existing handler — including
 * the ones tests install — stays a function of one argument.
 */
export type WebUIInteractionObserver = {
  onSettled?: (id: string, reason: 'answered' | 'timeout' | 'aborted' | 'error') => void
}

// A prompt nobody answers must not wedge the turn: fall back to the safe answer.
const INTERACTION_TIMEOUT_MS = 180_000

export class AgentBridge {
  private config: AppConfig
  private cwd: string
  private sessionId: string
  private messages: Message[] = []
  private usage: SessionUsage = emptyUsage()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private hookCtx?: string
  private turnSeq = 0
  private controller: AbortController | null = null
  // Set the moment a turn is admitted, before the first await — see runTurn.
  private turnActive = false

  constructor(config: AppConfig, cwd: string = process.cwd()) {
    this.config = config
    this.cwd = cwd
    this.sessionId = newSessionId()
    startMcpServers(this.cwd)
  }

  public destroy(): void {
    if (this.controller) {
      this.controller.abort()
      this.controller = null
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    stopMcpServers()
    this.flushSave()
  }

  /**
   * The config as anything OUTSIDE this process may see it.
   *
   * Two credentials come off: `apiKey` (env-sourced, never leaves the host) and
   * the `apiKeySetting` row (the hand-typed key, which config.ts resolves into
   * the in-memory bag). The row is DELETED rather than masked with a marker —
   * see redactSettings — because this object flows BACK into updateConfig from
   * several directions (`/config <key> <value>` in the browser, which rebuilds
   * the whole bag from the one it read; POST /api/config with a whole bag), and
   * a placeholder on that path overwrites the user's real key with the literal
   * string 'set'.
   *
   * Everything reaching this accessor is a sink: GET /api/config, the
   * config:update SSE broadcast, getState()'s config (broadcast too), the
   * command context, the plugin context, and the title summarizer's own copy.
   * For a listing that must REPORT that a credential exists, read
   * `liveSettings()` and format a marker — do not re-add the row here.
   */
  public getConfig(): AppConfig {
    const { apiKey: _omit, ...safe } = this.config
    return { ...safe, settings: redactSettings(safe.settings) } as AppConfig
  }

  /**
   * The settings bag with credentials INTACT — for the few in-process callers
   * that must see the real value: /api/settings computing its "set (13 chars)"
   * marker, and re-resolving the credential row when a resumed session's config
   * is adopted (a stored snapshot is redacted, so merging it in blindly would
   * drop the key from the live bag and the next save would clear it).
   *
   * Deliberately NOT exported over HTTP or handed to a plugin: everything
   * crossing a boundary goes through getConfig().
   */
  public liveSettings(): Record<string, SettingValue> {
    return this.config.settings ?? {}
  }

  public updateConfig(patch: Partial<AppConfig>): AppConfig {
    this.config = {
      ...this.config,
      ...patch,
      settings: { ...(this.config.settings ?? {}), ...(patch.settings ?? {}) },
    }
    entryAwareSaveConfig(this.config)
    return this.getConfig()
  }

  public getState(): {
    sessionId: string
    messages: Message[]
    usage: SessionUsage
    isRunning: boolean
    config: AppConfig
  } {
    return {
      sessionId: this.sessionId,
      messages: this.messages,
      usage: this.usage,
      // The turn claim, not the controller: during the hook phase of a turn there
      // is a real turn in progress but no controller yet, and the client's
      // `isRunning` drives its send/stop button.
      isRunning: this.turnActive,
      config: this.getConfig(),
    }
  }

  public resetSession(): { sessionId: string } {
    if (this.controller) {
      this.controller.abort()
      this.controller = null
    }
    this.flushSave()
    this.messages = []
    this.sessionId = newSessionId()
    this.usage = emptyUsage()
    this.turnSeq = 0
    return { sessionId: this.sessionId }
  }

  public listSessions(): SessionMeta[] {
    return listSessions(this.cwd)
  }

  public deleteSession(id: string): boolean {
    const ok = deleteSession(id)
    if (id === this.sessionId) {
      this.resetSession()
      return true
    }
    return ok
  }

  public renameSession(id: string, newTitle: string): boolean {
    const currentSnap = (id === this.sessionId) ? {
      config: this.config,
      messages: this.messages,
      goal: null,
      loop: null,
      usage: this.usage,
    } : undefined
    return renameSession(id, newTitle, currentSnap)
  }

  public loadSession(id: string): boolean {
    if (this.controller) {
      this.controller.abort()
      this.controller = null
    }
    this.flushSave()
    const snap = loadSession(id)
    if (!snap) return false
    this.sessionId = id
    this.messages = snap.messages || []
    this.usage = snap.usage || emptyUsage()
    if (snap.config) {
      // Same rule as cli.tsx's resumeConfig: a stored snapshot is written
      // REDACTED, so spreading it in would drop the credential row and the next
      // save would call saveApiKey('') — or, for a file written before
      // redaction, put a stale key back over the current one. withLiveKey
      // re-resolves the row from credentials.json.
      this.config = withLiveKey({ ...this.config, ...snap.config })
    }
    this.turnSeq = this.messages.filter((m) => m.role === 'user').length
    return true
  }

  public async runTool(name: string, input: Record<string, unknown>): Promise<any> {
    const ctx: ToolContext = {
      cwd: this.cwd,
      rewind: getSetting(this.config.settings, 'rewindCode') !== false,
    }
    return await runTool(name, input, ctx)
  }

  /**
   * The permission layering the agent loop applies before every tool call in
   * providers/anthropic.ts — persistent rules first, then the mode decision,
   * then the interactive handshake — exposed for the HTTP tool route so the
   * browser cannot reach a mutating tool by asking for it directly instead of
   * letting the model ask. Same order, same helpers, one place to change.
   */
  public async authorizeToolCall(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ allow: true } | { allow: false; reason: string }> {
    const mode = String(getSetting(this.config.settings, 'permissionMode') || 'default')
    const permMode = isPermissionMode(mode) ? mode : 'default'
    let decision = decidePermission(permMode, name, {
      autoModeInPlan: getSetting(this.config.settings, 'autoModeInPlan') === true,
    })
    const rule = matchPermissionRule(name, input, this.config.permissions)
    if (rule === 'deny') {
      decision = { action: 'deny', reason: DENY_RULE_REASON }
    } else if (rule === 'allow' && decision.action === 'ask') {
      decision = { action: 'allow' }
    } else if (rule === 'ask' && decision.action === 'allow' && permMode !== 'bypassPermissions') {
      decision = { action: 'ask' }
    }

    if (decision.action === 'allow') return { allow: true }
    if (decision.action === 'deny') return { allow: false, reason: decision.reason }

    const verdict = await this.promptPermission({
      tool: name,
      input,
      summary: summarizeToolCall(name, input),
    })
    if (verdict === 'allow') return { allow: true }
    return { allow: false, reason: '用户拒绝了本次工具调用。' }
  }

  public listTools(): any[] {
    return toolSchemas(true, this.config.settings?.dynamicWorkflows !== false, this.cwd)
  }

  public abortTurn(): { aborted: boolean } {
    if (!this.controller) return { aborted: false }
    this.controller.abort()
    return { aborted: true }
  }

  private buildSystem(): string {
    const preamble = standingPreamble()
    const projInstr = projectInstructionsPreamble(this.cwd)
    const agentCatalog = customAgentCatalog(this.cwd)
    const agentsPreamble = agentCatalog
      ? `## Custom sub-agents\nBesides the built-in roles (general, explore, code, plan), these project-defined sub-agents are available as \`subagent_type\` for the task/workflow tools:\n${agentCatalog}`
      : undefined
    const effortLevel = String(getSetting(this.config.settings, 'effort'))
    return [
      AGENT_SYSTEM,
      effortDirective(effortLevel),
      outputStyleDirective(String(getSetting(this.config.settings, 'outputStyle'))),
      workflowSizeDirective(
        String(
          getSetting(this.config.settings, 'dynamicWorkflows') !== false
            ? getSetting(this.config.settings, 'dynamicWorkflowSize')
            : undefined,
        ),
      ),
      preamble,
      projInstr,
      agentsPreamble,
      this.hookCtx,
      this.config.system,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flushSave()
    }, 1500)
  }

  private flushSave(): void {
    saveSession(this.sessionId, {
      config: this.config,
      messages: this.messages,
      goal: null,
      loop: null,
      usage: this.usage,
    })
  }

  /**
   * The bridge owns the mid-turn queues the agent loop drains via `takePending`
   * and `takeEvents` (see StreamOpts). The browser submits a follow-up line while
   * a turn is streaming through /api/turn → here → `pendingInput`; async events
   * (monitor/schedule output, notices) arrive through `pushAsyncEvent`. Draining
   * is the browser analogue of app.tsx's `queued` state — without it the WebUI
   * turn always ends before a typed line reaches the model.
   */
  private pendingInput: string[] = []
  private asyncEvents: string[] = []
  private interactionSeq = 0
  private interactionHandler: WebUIInteractionHandler | null = null

  /** Installed by the server so a turn can ask the browser a question. */
  public setInteractionHandler(handler: WebUIInteractionHandler | null): void {
    this.interactionHandler = handler
  }

  private async ask(req: WebUIInteraction): Promise<WebUIInteractionResponse | null> {
    if (!this.interactionHandler) return null
    // An unanswered prompt must never wedge the turn forever — a closed browser
    // tab would otherwise hang the agent until the process exits. Two escapes, not
    // one: the timeout covers a tab that was closed without answering, and an abort
    // covers the Abort button, which only aborts the provider's fetch — without the
    // second race a user who hit Abort on a permission dialog sat there for the
    // full 180s, because nothing the turn was awaiting had an abort signal.
    //
    // Both escapes are reported to the server as a *settlement*, so a prompt the
    // turn has already walked away from is not left parked in its registry
    // forever: the server keeps answered entries around for idempotent retries
    // (see its /api/interaction/respond) and would otherwise keep re-broadcasting
    // them to every tab on every poll, long after the turn that raised them ended.
    const settle = (reason: 'answered' | 'timeout' | 'aborted' | 'error') =>
      this.interactionHandler?.onSettled?.(req.id, reason)
    // The abort arm only joins the race when there *is* a controller to abort. A
    // direct /api/tools/call runs no turn, so `this.controller` is null and an
    // always-settled abort arm would resolve the prompt before anybody could answer
    // it — turning every parked permission into an instant deny.
    const races: Promise<WebUIInteractionResponse | null>[] = [
      this.interactionHandler(req).then((r) => {
        settle('answered')
        return r
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          settle('timeout')
          resolve(null)
        }, INTERACTION_TIMEOUT_MS),
      ),
    ]
    const signal = this.controller?.signal
    if (signal) {
      races.push(
        new Promise<null>((resolve) => {
          const done = () => {
            settle('aborted')
            resolve(null)
          }
          if (signal.aborted) done()
          else signal.addEventListener('abort', done, { once: true })
        }),
      )
    }
    try {
      return (await Promise.race(races)) ?? null
    } catch {
      settle('error')
      return null
    }
  }

  private async promptPermission(req: PermissionRequest): Promise<'allow' | 'deny'> {
    const res = await this.ask({
      kind: 'permission',
      id: `perm-${++this.interactionSeq}`,
      tool: req.tool,
      input: req.input,
      summary: req.summary,
    })
    if (!res || !('decision' in res)) return 'deny'
    return res.decision
  }

  private async promptUserInput(req: UserInputRequest): Promise<UserInputResponse> {
    const res = await this.ask({
      kind: 'userInput',
      id: `ask-${++this.interactionSeq}`,
      questions: req.questions,
    })
    if (!res || !('answers' in res)) return { answers: [], cancelled: true }
    return { answers: res.answers, cancelled: res.cancelled }
  }

  /**
   * Park a follow-up line for the running turn.
   *
   * What a human types into the prompt box while a turn streams is prose meant for
   * the model mid-turn, so it goes straight into `pendingInput` — the same shape
   * app.tsx's `send`/`takePending` pair uses, and the same reason a slash command
   * is routed back out: a `/…` line is not prose, and feeding one to the model as
   * text would run a command's words as an instruction instead of executing it.
   * Returning false tells the caller it did not land here, so the route can do what
   * the TUI's idle flush does and run it as its own turn.
   */
  public queuePending(text: string): boolean {
    const line = text.trim()
    if (!line) return false
    if (isCommand(line)) return false
    this.pendingInput.push(line)
    return true
  }

  private takePending(): string[] {
    return this.pendingInput.splice(0)
  }

  /**
   * What is still queued after a turn ended.
   *
   * The provider drains `takePending` only after a *tool batch*, so a line typed
   * while the model was streaming its final answer is still sitting in the queue
   * when the turn returns — and nothing else would ever pick it up, which is how a
   * typed line used to vanish. The TUI avoids this by flushing on Esc (app.tsx);
   * the browser has the same hook, so the leftover is returned rather than dropped
   * and the caller runs it as the next turn.
   */
  public drainPending(): string[] {
    return this.takePending()
  }

  /** Append an async event line, exactly as lib/background would frame it for the TUI. */
  public pushAsyncEvent(event: string): void {
    this.asyncEvents.push(event)
  }

  private takeEvents(): string[] {
    return this.asyncEvents.splice(0)
  }

  public async runTurn(
    prompt: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<{ turn: number }> {
    const trimmed = prompt.trim()
    if (!trimmed) throw new Error('Prompt cannot be empty')
    // The old guard was `if (this.controller)`, which is a TOCTOU: this method
    // awaits two hook runs before it creates the controller, so two /api/turn
    // requests that arrive together both pass the check and both stream into the
    // same message list — two turns interleaved into one transcript, with each
    // one's tool calls racing the other's. Claim the turn *here*, before the
    // first await, and hold it until the finally that releases it.
    if (this.turnActive) throw new Error('A turn is already in progress')
    this.turnActive = true
    try {
      return await this.runTurnAdmitted(trimmed, onEvent)
    } finally {
      // Every path out of the turn has to give the claim back, or the bridge
      // refuses every turn for the life of the process.
      this.turnActive = false
    }
  }

  private async runTurnAdmitted(
    trimmed: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<{ turn: number }> {
    if (this.hookCtx === undefined) {
      const ss = await runHooks('SessionStart', { source: 'startup' }, this.cwd)
      this.hookCtx = ss.context || ''
      if (ss.systemMessage) {
        this.messages = [...this.messages, { id: 'hook-ss', role: 'system', content: ss.systemMessage }]
      }
    }

    const ups = await runHooks('UserPromptSubmit', { prompt: trimmed }, this.cwd)
    if (ups.systemMessage) {
      this.messages = [...this.messages, { id: 'hook-ups', role: 'system', content: ups.systemMessage }]
    }
    if (ups.decision === 'deny' || ups.stop) {
      this.messages = [
        ...this.messages,
        { id: 'hook-block', role: 'system', content: `Prompt blocked: ${ups.reason ?? ''}`, meta: { error: true } },
      ]
      this.scheduleSave()
      return { turn: this.turnSeq }
    }

    const turn = ++this.turnSeq
    const userMsg: Message = { id: `u${turn}`, role: 'user', content: trimmed, meta: { ts: Date.now() } }
    if (ups.context) userMsg.meta = { ...userMsg.meta, injectedContext: ups.context }
    this.messages = [...this.messages, userMsg]

    const cfg = this.config
    const provider = getProvider(cfg)
    const effortLevel = String(getSetting(cfg.settings, 'effort'))
    const thinkingMode = String(getSetting(cfg.settings, 'thinkingMode'))
    const assistantId = `a${turn}`
    const system = this.buildSystem()
    // Prompt-size estimate as the billing/context fallback for providers that
    // report no usage (mock). Mirrors useChat's inputEstimate, minus the UI-only
    // bits: this bridge keeps no banner or attachment in `messages`.
    const inputEstimate =
      estimateTokens(system) +
      this.messages.reduce(
        (n, m) =>
          n +
          (m.content === '__banner__' || m.meta?.folded || m.meta?.command
            ? 0
            : estimateTokens(m.content)) +
          estimateTokens(m.meta?.injectedContext ?? '') +
          (m.meta?.attachments?.length ?? 0) * 1600,
        0,
      )

    let acc = ''
    let thinkingAcc = ''
    let errorMsg = ''
    const turnStart = Date.now()
    const t = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
    let sawUsage = false
    const controller = new AbortController()
    this.controller = controller

    try {
      if (!provider.agent) {
        for await (const chunk of provider.stream(this.messages, {
          model: cfg.model,
          system,
          signal: controller.signal,
        })) {
          acc += chunk
          onEvent({ type: 'text', text: chunk })
        }
      } else {
        for await (const ev of provider.agent(this.messages, {
          model: cfg.model,
          system,
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
          permissionMode: String(getSetting(cfg.settings, 'permissionMode') || 'default'),
          autoModeInPlan: getSetting(cfg.settings, 'autoModeInPlan') === true,
          permissionRules: cfg.permissions,
          takePending: () => this.takePending(),
          takeEvents: () => this.takeEvents(),
          requestPermission: (req) => this.promptPermission(req),
          requestUserInput: (req) => this.promptUserInput(req),
          onPermissionModeChange: (mode: string) => {
            this.config = { ...this.config, settings: { ...(this.config.settings ?? {}), permissionMode: mode } }
            entryAwareSaveConfig(this.config)
          },
          onWorkflow: (snap: WorkflowSnapshot) => onEvent({ type: 'workflow', snap } as unknown as AgentEvent),
          onAgent: (snap: AgentSnapshot) => onEvent({ type: 'agent', snap } as unknown as AgentEvent),
        })) {
          if (ev.type === 'thinking') {
            thinkingAcc += ev.text
          } else if (ev.type === 'text') {
            acc += ev.text
          } else if (ev.type === 'tool_use') {
            if (thinkingAcc.trim()) {
              this.messages = [
                ...this.messages,
                { id: `${assistantId}-t`, role: 'assistant', content: thinkingAcc, meta: { thinking: true } },
              ]
              thinkingAcc = ''
            }
            if (acc.trim()) {
              this.messages = [...this.messages, { id: assistantId, role: 'assistant', content: acc }]
              acc = ''
            }
            this.usage.toolCalls++
            this.messages = [
              ...this.messages,
              {
                id: ev.id,
                role: 'tool',
                content: `● ${summarizeToolCall(ev.name, ev.input)}`,
                meta: { toolName: ev.name, toolInput: ev.input },
              },
            ]
          } else if (ev.type === 'tool_result') {
            if (ev.linesAdded) this.usage.linesAdded += ev.linesAdded
            if (ev.linesRemoved) this.usage.linesRemoved += ev.linesRemoved
            this.messages = [
              ...this.messages,
              ev.diff?.length && !ev.isError
                ? {
                    id: `${ev.id}-r`,
                    role: 'tool',
                    content: `⎿ ${changeSummary(ev.linesAdded ?? 0, ev.linesRemoved ?? 0)}`,
                    meta: { diff: ev.diff, toolName: ev.name, toolContent: ev.content, toolDisplay: ev.display },
                  }
                : {
                    id: `${ev.id}-r`,
                    role: 'tool',
                    content: formatToolResult(ev.display ?? ev.content, ev.isError),
                    meta: {
                      ...(ev.isError ? { error: true } : {}),
                      toolName: ev.name,
                      toolContent: ev.content,
                      toolDisplay: ev.display,
                    },
                  },
            ]
          } else if (ev.type === 'usage') {
            sawUsage = true
            t.input += ev.inputTokens
            t.output += ev.outputTokens
            t.cacheRead += ev.cacheReadTokens ?? 0
            t.cacheCreation += ev.cacheCreationTokens ?? 0
          } else if (ev.type === 'error') {
            errorMsg = ev.message
          }
          onEvent(ev)
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        errorMsg = (err as Error)?.message ?? String(err)
      }
    } finally {
      this.controller = null
    }

    if (thinkingAcc.trim()) {
      this.messages = [
        ...this.messages,
        { id: `${assistantId}-t`, role: 'assistant', content: thinkingAcc, meta: { thinking: true } },
      ]
    }

    const interrupted = controller.signal.aborted
    if (acc.trim() || interrupted) {
      this.messages = [
        ...this.messages,
        { id: assistantId, role: 'assistant', content: acc, meta: interrupted ? { interrupted: true } : undefined },
      ]
    }

    if (errorMsg && !interrupted) {
      this.messages = [...this.messages, { id: `e${turn}`, role: 'system', content: `⚠ ${errorMsg}`, meta: { error: true } }]
    }

    // Fold this turn into the totals, same policy as useChat: the provider's real
    // counts (incl. cache) win, estimates fill in when it reported none (mock),
    // and cost is always computed at official rates whatever provider.
    const inTok = sawUsage ? t.input : inputEstimate
    const outTok = sawUsage ? t.output : estimateTokens(acc)
    const turnCost = computeCost(
      {
        inputTokens: inTok,
        outputTokens: outTok,
        cacheReadTokens: t.cacheRead,
        cacheCreationTokens: t.cacheCreation,
      },
      cfg.model,
    )
    this.usage.turns++
    this.usage.inputTokens += inTok
    this.usage.outputTokens += outTok
    this.usage.cacheReadTokens += t.cacheRead
    this.usage.cacheCreationTokens += t.cacheCreation
    this.usage.apiMs += Date.now() - turnStart
    this.usage.costUsd += turnCost
    this.scheduleSave()

    return { turn }
  }
}
