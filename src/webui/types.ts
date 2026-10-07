import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentEvent, AppConfig, Message, SessionUsage } from '../types'

// ============================================================================
// Extension Slots (扩展插槽)
// ============================================================================

/**
 * Every slot the WebUI reserves for extensions, in mount order. Kept as a runtime
 * constant (not just a union) so it can be enumerated — `webui.test.ts` asserts
 * that each id has a `[data-slot]` mount point in the shipped HTML, which is what
 * keeps "reserved slots" from quietly rotting into declared-but-unmounted ones.
 */
export const SLOT_IDS = [
  'header:left',         // Left of header next to brand logo
  'header:center',       // Center of header (e.g. model chip, status)
  'header:actions',      // Right side of header (action buttons)
  'sidebar:header',      // Top of sidebar
  'sidebar:nav',         // Sidebar navigation links/tabs
  'sidebar:footer',      // Bottom of sidebar
  'chat:top',            // Banner / notification above chat transcript
  'chat:toolbar',        // Action toolbar directly above prompt input
  'chat:input_actions',  // Extra action buttons next to submit button
  'message:header',      // Rendered directly above each message content
  'message:footer',      // Rendered directly below each message content
  'message:actions',     // Action buttons on message hover/card
  'statusbar:left',      // Left of bottom status bar
  'statusbar:center',    // Center of bottom status bar
  'statusbar:right',     // Right of bottom status bar
] as const

export type WellKnownSlotId = (typeof SLOT_IDS)[number] | string

export interface SlotContext {
  session?: {
    id: string
    title: string
    messages: Message[]
    usage: SessionUsage
  }
  message?: Message
  config?: AppConfig
  sdk: MeowWebSDK
  activePanel?: string
}

export interface SlotItem {
  id: string
  priority?: number // Higher number = mounts earlier (left-to-right / top-to-bottom)
  render: (container: HTMLElement, context: SlotContext) => (() => void) | void
}

// ============================================================================
// Custom Panels (扩展面板)
// ============================================================================

export interface PanelContext {
  sdk: MeowWebSDK
  container: HTMLElement
}

export interface PanelDefinition {
  id: string
  title: string
  icon?: string // SVG string, emoji, or icon name
  badge?: string | number | (() => string | number | null)
  priority?: number
  render: (container: HTMLElement, context: PanelContext) => (() => void) | void
}

// ============================================================================
// Custom Tool Renderers (自定义工具渲染器)
// ============================================================================

export interface ToolCallData {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultData {
  id: string
  name: string
  content?: string
  display?: string
  diff?: Array<{ type: 'add' | 'del' | 'same'; line: string }>
  isError?: boolean
}

export interface ToolRenderer {
  toolName: string
  render: (
    container: HTMLElement,
    call: ToolCallData,
    result?: ToolResultData,
    context?: { sdk: MeowWebSDK },
  ) => (() => void) | void
}

// ============================================================================
// Custom Commands (扩展命令)
// ============================================================================

export interface CommandDefinition {
  id: string
  title: string
  shortcut?: string
  category?: string
  execute: (sdk: MeowWebSDK) => void | Promise<void>
}

// ============================================================================
// Frontend SDK Client Interface (前端 SDK 契约)
// ============================================================================

export interface SlotManager {
  register: (slotId: WellKnownSlotId, item: SlotItem) => () => void
  unregister: (slotId: WellKnownSlotId, itemId: string) => void
  getSlotItems: (slotId: WellKnownSlotId) => SlotItem[]
  renderSlot: (slotId: WellKnownSlotId, container: HTMLElement, context: SlotContext) => () => void
}

export interface PanelManager {
  register: (panel: PanelDefinition) => () => void
  unregister: (panelId: string) => void
  getPanels: () => PanelDefinition[]
  getActivePanel: () => string
  setActivePanel: (panelId: string) => void
}

export interface ToolRendererManager {
  register: (renderer: ToolRenderer) => () => void
  unregister: (toolName: string) => void
  getRenderer: (toolName: string) => ToolRenderer | undefined
}

export interface CommandManager {
  register: (command: CommandDefinition) => () => void
  unregister: (commandId: string) => void
  getCommands: () => CommandDefinition[]
  execute: (commandId: string) => Promise<void>
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeManager {
  getTheme: () => ThemeMode
  getEffectiveTheme: () => 'light' | 'dark'
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => 'light' | 'dark'
  register: (name: string, tokens: Record<string, string>) => void
}

export interface ToastOptions {
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  durationMs?: number
}

export interface ModalOptions {
  title: string
  content: string | HTMLElement
  width?: string
  confirmText?: string
  cancelText?: string
  onConfirm?: () => boolean | void | Promise<boolean | void>
  onCancel?: () => void
}

export interface UIHelpers {
  showToast: (options: ToastOptions | string) => void
  showModal: (options: ModalOptions) => () => void
  openPanel: (panelId: string) => void
  toggleSidebar: () => void
}

export interface WebUIApiClient {
  sendMessage: (prompt: string) => Promise<{ turn: number }>
  abort: () => Promise<{ aborted: boolean }>
  /** Queue a follow-up line for the turn currently streaming (mid-turn type-ahead). */
  queueTurnText: (text: string) => Promise<{ ok: boolean }>
  /** Answer a pending permission / ask_user prompt raised by the running turn. */
  respondInteraction: (
    id: string,
    response: { decision: 'allow' | 'deny'; reason?: string } | { answers: string[][]; cancelled?: boolean },
  ) => Promise<{ ok: boolean }>
  getState: () => Promise<{ sessionId: string; messages: Message[]; usage: SessionUsage; isRunning: boolean; config: AppConfig }>
  resetSession: () => Promise<{ sessionId: string }>
  listSessions: () => Promise<Array<{ id: string; savedAt: number; cwd: string; title: string; messageCount: number }>>
  loadSession: (id: string) => Promise<{ ok: boolean; session: any }>
  getConfig: () => Promise<AppConfig>
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  listTools: () => Promise<{ tools: any[] }>
  callTool: (name: string, input: Record<string, unknown>) => Promise<any>
  callBackendPlugin: (pluginId: string, action: string, payload?: unknown) => Promise<any>
}

export interface M3Helper {
  isAvailable: () => boolean
  version: string
  tags: string[]
  create: (tag: string, attributes?: Record<string, any>, innerContent?: string | HTMLElement) => HTMLElement
}

export interface MeowWebSDK {
  version: string
  slots: SlotManager
  panels: PanelManager
  tools: ToolRendererManager
  commands: CommandManager
  theme: ThemeManager
  ui: UIHelpers
  api: WebUIApiClient
  m3: M3Helper
  on: (event: string, callback: (...args: any[]) => void) => () => void
  off: (event: string, callback: (...args: any[]) => void) => void
  emit: (event: string, ...args: any[]) => void
  registerPlugin: (plugin: FrontendPlugin) => Promise<void>
}

export interface FrontendPlugin {
  id: string
  name: string
  version: string
  description?: string
  setup: (sdk: MeowWebSDK) => void | Promise<void>
}

// ============================================================================
// Backend Plugin / Extension Interface (后端插件 SDK 契约)
// ============================================================================

export interface PluginContext {
  pluginId: string
  sessionId: string
  cwd: string
  config: AppConfig
  callTool: (name: string, input: Record<string, unknown>) => Promise<any>
  broadcastEvent: (event: string, data: unknown) => void
}

export type PluginRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: any,
  ctx: PluginContext,
) => Promise<unknown> | unknown

export interface WebUIPlugin {
  id: string
  name: string
  version: string
  description?: string
  frontendScript?: string // Inline JavaScript or file path served to browser
  /**
   * The directory `frontendScript` is relative to, when it is a path rather than
   * inline code. A plugin loaded from disk (the future external-plugin loader,
   * or a converter emitting Claude-Code-style plugins) sets this to its own
   * directory so its assets travel with it; unregistered in-process plugins omit
   * it and fall back to the workspace cwd. See PluginManager.getFrontendScripts.
   */
  baseDir?: string
  routes?: Record<string, PluginRouteHandler>
  onTurnStart?: (ctx: PluginContext, prompt: string) => Promise<void> | void
  onAgentEvent?: (ctx: PluginContext, event: AgentEvent) => Promise<void> | void
  onTurnEnd?: (ctx: PluginContext, summary: { turn: number; interrupted: boolean }) => Promise<void> | void
  onToolCall?: (ctx: PluginContext, toolName: string, input: Record<string, unknown>) => Promise<any> | any
}

// ============================================================================
// WebUI Server Options & Instance
// ============================================================================

export interface WebUIOptions {
  port?: number
  host?: string
  openBrowser?: boolean
  cwd?: string
  config?: AppConfig
  plugins?: WebUIPlugin[]
  /**
   * Access control for the /api routes. The server drives the agent with
   * bypassPermissions and `/api/tools/call` reaches any tool, so a per-run token
   * is required by default; the served page embeds it, so opening the printed URL
   * just works. `auth: false` disables the check — only for a trusted, isolated
   * context (e.g., behind a reverse proxy that already authenticated). This is
   * the "reach it from anywhere on purpose" switch: it hands the agent to anyone
   * who can open the port, so it must be asked for explicitly and is never the
   * default. The origin allowlist stays on either way.
   */
  auth?: boolean
  /**
   * Use this token instead of a freshly generated one (e.g., a launcher that
   * wants a stable URL across restarts, or tests that need a known credential).
   */
  authToken?: string
}

export interface WebUIServerInstance {
  // The per-run API token ('' when auth is disabled). Append it as ?token=… to
  // reach the API from a client that isn't the served page.
  token: string
  port: number
  host: string
  /** The openable URL, token fragment included — opening it authenticates you. */
  url: string
  /** The same server without the fragment; safe to print in logs. */
  baseUrl: string
  close: () => Promise<void>
  registerPlugin: (plugin: WebUIPlugin) => void
  getPlugins: () => WebUIPlugin[]
}
