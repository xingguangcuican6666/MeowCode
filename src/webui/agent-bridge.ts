import { getProvider } from '../providers'
import { runTool, toolSchemas, summarizeToolCall } from '../tools'
import { newSessionId, saveSession, loadSession, listSessions, deleteSession, renameSession, type SessionMeta } from '../lib/sessions'
import type { AgentEvent, AgentSnapshot, AppConfig, DiffLine, Message, SessionUsage, WorkflowSnapshot } from '../types'
import type { ToolContext } from '../tools/types'
import { AGENT_SYSTEM, formatToolResult } from '../hooks/chat-helpers'
import { standingPreamble } from '../lib/memory'
import { projectInstructionsPreamble } from '../lib/projectInstructions'
import { customAgentCatalog } from '../tools/orchestration'
import { runHooks } from '../lib/hooks'
import { getSetting, effortDirective, outputStyleDirective, workflowSizeDirective, resolveThinkingBudget } from '../lib/settings'
import { emptyUsage } from '../lib/usage'
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

  public getConfig(): AppConfig {
    const { apiKey: _omit, ...safe } = this.config
    return safe as AppConfig
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
      isRunning: this.controller !== null,
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
      this.config = { ...this.config, ...snap.config }
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

  public async runTurn(
    prompt: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<{ turn: number }> {
    const trimmed = prompt.trim()
    if (!trimmed) throw new Error('Prompt cannot be empty')
    if (this.controller) throw new Error('A turn is already in progress')

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

    let acc = ''
    let thinkingAcc = ''
    let errorMsg = ''
    const turnStart = Date.now()
    const t = { input: 0, output: 0 }
    const controller = new AbortController()
    this.controller = controller

    const isStubDefault = (provider.id === 'default' && !process.env.ANTHROPIC_API_KEY && !cfg.apiKey) || provider.id === 'mock'

    try {
      if (isStubDefault) {
        for await (const ev of this.simulateOfflineTurn(trimmed, controller.signal)) {
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
            t.input += ev.inputTokens
            t.output += ev.outputTokens
          } else if (ev.type === 'error') {
            errorMsg = ev.message
          }
          onEvent(ev)
        }
      } else if (!provider.agent) {
        for await (const chunk of provider.stream(this.messages, {
          model: cfg.model,
          system: this.buildSystem(),
          signal: controller.signal,
        })) {
          acc += chunk
          onEvent({ type: 'text', text: chunk })
        }
      } else {
        for await (const ev of provider.agent(this.messages, {
          model: cfg.model,
          system: this.buildSystem(),
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
          permissionMode: 'bypassPermissions',
          permissionRules: cfg.permissions,
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
            t.input += ev.inputTokens
            t.output += ev.outputTokens
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

    this.usage.turns++
    this.usage.inputTokens += t.input
    this.usage.outputTokens += t.output
    this.usage.apiMs += Date.now() - turnStart
    this.scheduleSave()

    return { turn }
  }

  private async *simulateOfflineTurn(
    prompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        const t = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
      })

    const streamTokens = async function* (
      text: string,
      type: 'text' | 'thinking',
    ): AsyncGenerator<AgentEvent, void, unknown> {
      const tokens = text.match(/\s+|\S+/g) ?? [text]
      for (let i = 0; i < tokens.length; i++) {
        if (signal.aborted) return
        yield { type, text: tokens[i] }
        if (i < tokens.length - 1) await sleep(10 + Math.random() * 15)
      }
    }

    const trimmed = prompt.trim()
    const lower = trimmed.toLowerCase()

    // 0. Todo / Task checklist trigger: todo: <task1, task2> or checklist: or "todo" / "任务清单"
    const todoMatch =
      /^(?:todo|todos|checklist|任务|待办):\s*([\s\S]*)/i.exec(trimmed) ||
      (lower === 'todo' || lower === 'checklist' || lower === 'todos' || lower.includes('todo list') || lower.includes('任务清单')
        ? [trimmed, '']
        : null)
    if (todoMatch) {
      const taskSpec = todoMatch[1]?.trim() || ''
      const items = taskSpec
        ? taskSpec.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
        : [
            'Inspect workspace architecture and tool registry',
            'Implement M3E tool call cards for todo_write',
            'Connect mock provider triggers & event stream',
            'Verify responsive layout & automated tests',
          ]

      yield* streamTokens(`Initializing task checklist with \`todo_write\`...`, 'thinking')
      if (signal.aborted) return

      // Step 1: Initial state (1st task in progress, others pending)
      const t1Id = `t_todo_${Date.now()}`
      const initialTodos = items.map((content, idx) => ({
        content,
        status: (idx === 0 ? 'in_progress' : 'pending') as 'in_progress' | 'pending',
        activeForm: idx === 0 ? `Working on: ${content}` : undefined,
      }))
      yield { type: 'tool_use', id: t1Id, name: 'todo_write', input: { todos: initialTodos } }
      await sleep(700)
      yield {
        type: 'tool_result',
        id: t1Id,
        name: 'todo_write',
        content: `Created task checklist with ${items.length} tasks (1 in progress, ${items.length - 1} pending).`,
      }
      await sleep(600)
      if (signal.aborted) return

      // Step 2: Progress first task to completed, second to in_progress
      yield* streamTokens(`Initial task complete. Advancing to next milestone...`, 'thinking')
      if (signal.aborted) return

      const t2Id = `t_todo_${Date.now() + 1}`
      const progressedTodos = items.map((content, idx) => ({
        content,
        status: (idx === 0 ? 'completed' : (idx === 1 ? 'in_progress' : 'pending')) as 'completed' | 'in_progress' | 'pending',
        activeForm: idx === 1 ? `Working on: ${content}` : undefined,
      }))
      yield { type: 'tool_use', id: t2Id, name: 'todo_write', input: { todos: progressedTodos } }
      await sleep(700)
      yield {
        type: 'tool_result',
        id: t2Id,
        name: 'todo_write',
        content: `Updated task checklist (1 completed, 1 in progress, ${Math.max(0, items.length - 2)} pending).`,
      }
      await sleep(500)
      if (signal.aborted) return

      // Step 3: Complete remaining tasks
      const t3Id = `t_todo_${Date.now() + 2}`
      const allDoneTodos = items.map((content) => ({
        content,
        status: 'completed' as const,
      }))
      yield { type: 'tool_use', id: t3Id, name: 'todo_write', input: { todos: allDoneTodos } }
      await sleep(500)
      yield {
        type: 'tool_result',
        id: t3Id,
        name: 'todo_write',
        content: `All ${items.length} tasks marked as completed.`,
      }
      await sleep(400)
      if (signal.aborted) return

      const doneText = [
        `### Task Checklist Successfully Executed`,
        '',
        `All **${items.length} tasks** have been processed through the \`todo_write\` tool:`,
        items.map((it) => `- ✓ **${it}**`).join('\n'),
        '',
        `The task list card above reflects real-time status transitions (\`pending\` → \`in_progress\` → \`completed\`).`,
      ].join('\n')

      yield* streamTokens(doneText, 'text')
      yield { type: 'usage', inputTokens: 680, outputTokens: 290, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // Direct search: search: <query> or web: <query>
    const searchMatch = /^(?:search|web):\s*(.+)/i.exec(trimmed)
    if (searchMatch) {
      const query = searchMatch[1].trim()
      yield* streamTokens(`Searching web documentation for "${query}"...`, 'thinking')
      if (signal.aborted) return
      const id = `t_search_${Date.now()}`
      yield { type: 'tool_use', id, name: 'web_search', input: { query } }
      await sleep(500)
      const res = `1. Material Design 3 Guidelines (https://m3.material.io)\n2. Material Expressive Motion & Container Shapes\n3. Web Components Local Custom Elements Spec`
      yield { type: 'tool_result', id, name: 'web_search', content: res }
      await sleep(300)
      yield* streamTokens(`Search completed for "${query}". Found 3 relevant references.`, 'text')
      yield { type: 'usage', inputTokens: 420, outputTokens: 160, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // Direct ask: ask: <question>
    const askMatch = /^ask:\s*(.+)/i.exec(trimmed)
    if (askMatch) {
      const question = askMatch[1].trim()
      yield* streamTokens(`Asking user for input on "${question}"...`, 'thinking')
      if (signal.aborted) return
      const id = `t_ask_${Date.now()}`
      yield {
        type: 'tool_use',
        id,
        name: 'ask_user',
        input: {
          questions: [
            {
              question,
              options: [
                { label: 'Option A: Automatic execution', description: 'Run all steps sequentially without pauses' },
                { label: 'Option B: Step-by-step confirmation', description: 'Prompt before modifying any file' },
              ],
            },
          ],
        },
      }
      await sleep(600)
      yield { type: 'tool_result', id, name: 'ask_user', content: 'User selected Option A: Automatic execution' }
      await sleep(300)
      yield* streamTokens(`Received user response. Proceeding with Option A: Automatic execution.`, 'text')
      yield { type: 'usage', inputTokens: 400, outputTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // 1. Direct tool shortcuts: run: <cmd>, read: <path>, ls: <path>
    const runMatch = /^(\/run|run:|\$)\s*([\s\S]+)/i.exec(trimmed)
    if (runMatch) {
      const cmd = runMatch[2].trim()
      yield* streamTokens(`Executing terminal command via \`bash\` tool: \`${cmd}\`...`, 'thinking')
      if (signal.aborted) return
      const id = `t_bash_${Date.now()}`
      yield { type: 'tool_use', id, name: 'bash', input: { command: cmd } }
      await sleep(350)
      let output = ''
      let isError = false
      try {
        const res = await this.runTool('bash', { command: cmd })
        output = res.content || res.display || '(no output)'
        isError = Boolean(res.isError)
      } catch (err: any) {
        output = err.message || String(err)
        isError = true
      }
      yield { type: 'tool_result', id, name: 'bash', content: output, isError }
      await sleep(200)
      yield* streamTokens(`Command finished with exit code ${isError ? '1 (FAILED)' : '0 (OK)'}.`, 'text')
      yield { type: 'usage', inputTokens: 450, outputTokens: 180, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    const readMatch = /^(\/read|read:)\s*([^\s]+)/i.exec(trimmed)
    if (readMatch) {
      const filePath = readMatch[2].trim()
      yield* streamTokens(`Locating and reading workspace file \`${filePath}\`...`, 'thinking')
      if (signal.aborted) return
      const id = `t_read_${Date.now()}`
      yield { type: 'tool_use', id, name: 'read_file', input: { path: filePath } }
      await sleep(300)
      let content = ''
      let isError = false
      try {
        const res = await this.runTool('read_file', { path: filePath })
        content = res.content || ''
        isError = Boolean(res.isError)
      } catch (err: any) {
        content = err.message || String(err)
        isError = true
      }
      yield { type: 'tool_result', id, name: 'read_file', content, isError }
      await sleep(200)
      yield* streamTokens(`Loaded ${filePath} successfully (${content.split('\n').length} lines).`, 'text')
      yield { type: 'usage', inputTokens: 520, outputTokens: 210, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    const lsMatch = /^(\/ls|ls:)\s*(.*)/i.exec(trimmed)
    if (lsMatch) {
      const dirPath = lsMatch[2].trim() || '.'
      yield* streamTokens(`Listing workspace directory \`${dirPath}\`...`, 'thinking')
      if (signal.aborted) return
      const id = `t_ls_${Date.now()}`
      yield { type: 'tool_use', id, name: 'list_dir', input: { path: dirPath } }
      await sleep(300)
      let content = ''
      let isError = false
      try {
        const res = await this.runTool('list_dir', { path: dirPath })
        content = res.content || ''
        isError = Boolean(res.isError)
      } catch (err: any) {
        content = err.message || String(err)
        isError = true
      }
      yield { type: 'tool_result', id, name: 'list_dir', content, isError }
      await sleep(200)
      yield* streamTokens(`Listed directory \`${dirPath}\`.`, 'text')
      yield { type: 'usage', inputTokens: 400, outputTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // 2. Test execution prompt
    if (lower.includes('test') || lower.includes('vitest') || lower.includes('check') || lower.includes('health')) {
      const thinking = [
        '1. Detecting workspace test suites in test/ and src/webui/...',
        '2. Formulating test command execution with bun/vitest...',
        '3. Inspecting test assertions, unit tests, and plugin hooks...',
        '4. Verifying harness integrity and reporting results...',
      ].join('\n')
      yield* streamTokens(thinking, 'thinking')
      if (signal.aborted) return

      const id = `t_test_${Date.now()}`
      yield { type: 'tool_use', id, name: 'bash', input: { command: 'bun run test' } }
      await sleep(600)

      const testOutput = [
        '✓ src/webui/webui.test.ts (11 tests) 38ms',
        '✓ test/tools.test.ts (24 tests) 52ms',
        '✓ test/agent.test.ts (18 tests) 44ms',
        '✓ test/config.test.ts (16 tests) 28ms',
        '✓ test/providers.test.ts (15 tests) 31ms',
        '✓ test/permissions.test.ts (20 tests) 35ms',
        '✓ test/sessions.test.ts (19 tests) 33ms',
        '✓ test/mcp.test.ts (14 tests) 27ms',
        '✓ test/hooks.test.ts (22 tests) 41ms',
        '',
        'Test Files  9 passed (9)',
        '     Tests  159 passed (159)',
        '  Duration  480ms',
        'All 9 test suites passed. Zero failures.',
      ].join('\n')

      yield { type: 'tool_result', id, name: 'bash', content: testOutput, isError: false }
      await sleep(350)

      const reply = [
        '### Test Suite Execution Succeeded',
        '',
        'All **159 automated tests** across 9 test suites passed with **100% pass rate** in 480ms:',
        '- **Harness & WebUI**: 11 passed (clean slots, SSE routes, M3 components)',
        '- **Tools & Orchestrator**: 24 passed (`bash`, `read_file`, `edit_file`, subagent)',
        '- **Agent Loop & Permissions**: 38 passed (guardrails, session state)',
        '- **Integrations & MCP**: 86 passed (config, credentials, hooks)',
        '',
        'Harness integrity is fully verified and green!',
      ].join('\n')

      yield* streamTokens(reply, 'text')
      yield { type: 'usage', inputTokens: 980, outputTokens: 420, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // 3. Refactor / Cache / Edit code
    if (lower.includes('refactor') || lower.includes('cache') || lower.includes('optimize') || lower.includes('clean')) {
      const thinking = [
        '1. Locating target modules for refactoring (cache & session layers)...',
        '2. Abstracting in-memory map to generic LRU cache with TTL invalidation...',
        '3. Generating atomic diff chunk for src/lib/cache.ts...',
        '4. Validating concurrency safety and TypeScript strict typing...',
      ].join('\n')
      yield* streamTokens(thinking, 'thinking')
      if (signal.aborted) return

      const id = `t_refactor_${Date.now()}`
      yield { type: 'tool_use', id, name: 'edit_file', input: { path: 'src/lib/cache.ts' } }
      await sleep(550)

      const diff: DiffLine[] = [
        { tag: 'context', text: 'export class MemoryStore<K, V> {' },
        { tag: 'del', text: '  private store = new Map<K, V>()' },
        { tag: 'add', text: '  private store = new Map<K, { value: V; expiresAt: number }>()' },
        { tag: 'add', text: '  private readonly defaultTtl: number' },
        { tag: 'context', text: '  constructor(ttlMs = 60_000) {' },
        { tag: 'add', text: '    this.defaultTtl = ttlMs' },
        { tag: 'context', text: '  }' },
        { tag: 'context', text: '  get(key: K): V | undefined {' },
        { tag: 'add', text: '    const entry = this.store.get(key)' },
        { tag: 'add', text: '    if (!entry) return undefined' },
        { tag: 'add', text: '    if (Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }' },
        { tag: 'del', text: '    return this.store.get(key)' },
        { tag: 'add', text: '    return entry.value' },
        { tag: 'context', text: '  }' },
      ]

      yield {
        type: 'tool_result',
        id,
        name: 'edit_file',
        content: 'edited src/lib/cache.ts (6 additions, 2 deletions)',
        diff,
        linesAdded: 6,
        linesRemoved: 2,
        isError: false,
      }
      await sleep(350)

      const reply = [
        '### ✨ Refactoring Proposal Complete',
        '',
        'I have refactored the caching subsystem into a generic, type-safe **TTL LRU Cache**:',
        '- **Automatic Stale Eviction**: Keys past `expiresAt` are invalidated automatically on access.',
        '- **Generic Typing**: Supports arbitrary keys and values with zero runtime casting.',
        '',
        '```typescript',
        "import { MemoryStore } from './lib/cache'",
        '',
        '// Initialize cache with 5-minute TTL',
        'const cache = new MemoryStore<string, SessionData>(300_000)',
        "cache.set('session-1', { userId: 'alice', active: true })",
        '```',
        '',
        'Diff patch is verified and ready.',
      ].join('\n')

      yield* streamTokens(reply, 'text')
      yield { type: 'usage', inputTokens: 1120, outputTokens: 510, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // 4. Explain / Architecture / Document
    if (lower.includes('explain') || lower.includes('architecture') || lower.includes('document') || lower.includes('how')) {
      const thinking = [
        '1. Reading project structure and inspecting package.json...',
        '2. Mapping out core layers: CLI harness, Provider abstraction, Tool registry, WebUI M3E studio...',
        '3. Synthesizing structural architecture overview...',
      ].join('\n')
      yield* streamTokens(thinking, 'thinking')
      if (signal.aborted) return

      const id = `t_explain_${Date.now()}`
      yield { type: 'tool_use', id, name: 'read_file', input: { path: 'package.json' } }
      await sleep(400)

      let pkgContent = ''
      try {
        const res = await this.runTool('read_file', { path: 'package.json' })
        pkgContent = res.content || ''
      } catch {
        pkgContent = '{\n  "name": "meowcode",\n  "version": "1.0.0"\n}'
      }

      yield { type: 'tool_result', id, name: 'read_file', content: pkgContent.slice(0, 500) + '...', isError: false }
      await sleep(300)

      const reply = [
        '### 🐾 MeowCode Architecture & Design Overview',
        '',
        'MeowCode is structured into clean, decoupled layers:',
        '',
        '1. **Core Harness & Orchestration** (`src/agent.ts`, `src/hooks/`)',
        '   - Autonomous perception-reasoning-action loop coordinating model prompts, permission enforcement, and self-healing tool execution.',
        '',
        '2. **Tool Ecosystem** (`src/tools/`)',
        '   - `bash`: Interactive command execution.',
        '   - `read_file`, `edit_file`, `write_file`: Safe code inspection and editing.',
        '   - `list_dir`, `grep`: Fast workspace indexing.',
        '',
        '3. **Material 3 Expressive WebUI** (`src/webui/`)',
        '   - Built-in studio with Google Material 3 Expressive (M3E) aesthetics.',
        '   - Dark/Light dynamic surface containers (`surface-container-lowest` through `highest`).',
        '   - Zero-dependency local `@material/web` custom elements.',
        '',
        '4. **Extension SDK** (`window.MeowSDK`)',
        '   - Extension slots (`header:*`, `sidebar:*`, `chat:*`, `statusbar:*`).',
        '   - Custom panel registration and tool visualizers.',
      ].join('\n')

      yield* streamTokens(reply, 'text')
      yield { type: 'usage', inputTokens: 1350, outputTokens: 640, cacheReadTokens: 0, cacheCreationTokens: 0 }
      return
    }

    // 5. General query / conversation
    const thinking = `Analyzing user request: "${trimmed.slice(0, 60)}". Formulating structured plan, verifying tool availability, and generating response...`
    yield* streamTokens(thinking, 'thinking')
    if (signal.aborted) return

    const reply = [
      `### MeowCode Assistant`,
      '',
      `I received your request:`,
      `> ${trimmed.replace(/\n/g, '\n> ')}`,
      '',
      `Here is what you can do in this interactive studio:`,
      `- **Task Checklist**: Type \`todo: task1, task2\` to exercise the **todo_write** M3E card.`,
      `- **Run Tests**: Click **Run Tests** or type \`/test\` to execute repository test diagnostics.`,
      `- **Explore Files**: Click **Files** tab or **@ File** chip to inspect and reference project files.`,
      `- **Inspect Tools**: Click **Tools** tab to view schemas and test tool execution.`,
      `- **Web Search**: Type \`search: query\` to test the **web_search** card.`,
      `- **Ask User**: Type \`ask: question\` to test the **ask_user** decision card.`,
      `- **Code Refactoring**: Request refactorings with live unified diff review.`,
      `- **Terminal Execution**: Type \`run: ls -la\` or \`run: bun run build\` to execute real terminal commands.`,
      '',
      '```typescript',
      '// Pair programming with MeowCode SDK',
      "window.MeowSDK.slots.register('chat:toolbar', {",
      "  id: 'custom-action',",
      '  render: (container) => {',
      "    console.log('Slot mounted successfully!');",
      '  }',
      '});',
      '```',
      '',
      'All controls, dialogs, and tools are interactive and ready for experimentation!',
    ].join('\n')

    yield* streamTokens(reply, 'text')
    yield { type: 'usage', inputTokens: 820, outputTokens: 380, cacheReadTokens: 0, cacheCreationTokens: 0 }
  }
}

