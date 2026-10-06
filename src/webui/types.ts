import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentEvent, AppConfig, Message, SessionUsage } from '../types'

// ============================================================================
// Extension Slots (扩展插槽)
// ============================================================================

export type WellKnownSlotId =
  | 'header:left'         // Left of header next to brand logo
  | 'header:center'       // Center of header (e.g. model chip, status)
  | 'header:actions'      // Right side of header (action buttons)
  | 'sidebar:header'      // Top of sidebar
  | 'sidebar:nav'         // Sidebar navigation links/tabs
  | 'sidebar:footer'      // Bottom of sidebar
  | 'chat:top'            // Banner / notification above chat transcript
  | 'chat:toolbar'        // Action toolbar directly above prompt input
  | 'chat:input_actions'  // Extra action buttons next to submit button
  | 'message:header'      // Rendered directly above each message content
  | 'message:footer'      // Rendered directly below each message content
  | 'message:actions'     // Action buttons on message hover/card
  | 'statusbar:left'      // Left of bottom status bar
  | 'statusbar:center'    // Center of bottom status bar
  | 'statusbar:right'     // Right of bottom status bar
  | string

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
}

export interface WebUIServerInstance {
  port: number
  host: string
  url: string
  close: () => Promise<void>
  registerPlugin: (plugin: WebUIPlugin) => void
  getPlugins: () => WebUIPlugin[]
}
