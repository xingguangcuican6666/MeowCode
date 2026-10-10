import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { loadConfig } from '../config'
import {
  SETTINGS,
  coerceSetting,
  formatSettingValue,
  getSetting,
  settingGroups,
  type SettingValue,
} from '../lib/settings'
import { messages as tuiMessages, interpolate, resolveLang, setLang, settingDesc, settingGroupLabel, settingLabel, t, translate } from '../lib/i18n'
import type { Lang, MessageEntry, MessageKey } from '../lib/i18n'
// Permission decisions live in AgentBridge.authorizeToolCall, which layers the
// same rules -> mode -> prompt sequence the TUI uses; the route only asks it for
// a verdict. Keeping the layering in one place is what stops the browser from
// being a permission bypass around the terminal's.
import { registry, runCommand } from '../commands'
import { themeList } from '../theme'
import { COMMAND_CONTEXT_VALUE_MEMBERS } from '../types'
import type { AppConfig, CommandContext, Message, MessageMeta, PanelTab, Role } from '../types'
import { WEBUI_MESSAGES } from './client/messages'
import { AgentBridge } from './agent-bridge'
import type { WebUIInteraction, WebUIInteractionResponse } from './agent-bridge'
import { PluginManager } from './plugin-manager'
import { generateWebUIHtml } from './client/html'
import { AUTH_COOKIE } from './security'
import { CLIENT_CSS } from './client/css'
import { CLIENT_SDK_JS } from './client/sdk'
import { CLIENT_APP_JS } from './client/app'
import { MATERIAL_WEB_JS } from './client/material-web'
import { workspaceFilesPlugin } from './plugins/workspace-files'
import { stableWebUIToken } from './token-store'
import { login as newapiLogin, submit2FA, fetchRelayKey, normalizeBase, resolveNewapiBase, logout as newapiLogout } from '../lib/newapi'
import { loginWithOAuth, resolveOAuthClientId, revokeOAuth, resolveRelayToken } from '../lib/oauth'
import { saveCredentials, loadCredentials, clearCredentials, keySource, loadApiKey, saveApiKey } from '../lib/credentials'
import { fetchModelCatalog } from '../lib/models'
import { toolsInspectorPlugin } from './plugins/tools-inspector'
import { promptTemplatesPlugin } from './plugins/prompt-templates'
import { metricsMonitorPlugin } from './plugins/metrics-monitor'
import type { PluginContext, WebUIOptions, WebUIPlugin, WebUIServerInstance } from './types'

/** The server's own shape plus the one method that is not public: see below. */
interface WebUIServerInternals extends WebUIServerInstance {
  listen: (p: number, onListening?: () => void) => http.Server
}

// True once this PROCESS has created a WebUI server. The `/web` command consults
// it (via isWebUIActive) and refuses to start another: without that guard the
// command palette's own probe — which executes every command to classify it (see
// renderCommandIndex) — ran `/web`, which called startWebUI({ openBrowser: true })
// for real, bound the next port, opened a browser tab, and the tab it opened then
// hit /api/commands and probed `/web` again. That is the runaway the user saw: a
// single process walking 4040→4041→4042→… forever, a tab per step. A WebUI never
// starts a second WebUI inside itself, so this is the honest invariant to assert.
let webuiProcessActive = false
export function isWebUIActive(): boolean {
  return webuiProcessActive
}

export function createWebUIServer(options: WebUIOptions = {}): WebUIServerInstance {
  webuiProcessActive = true
  const cwd = options.cwd || process.cwd()
  const config = options.config || loadConfig()
  const port = options.port || 4040
  const host = options.host || '127.0.0.1'

  // lib/i18n's language is module state, and every `t()` inside a command body
  // reads it — so what a command *prints* is whatever was current when this
  // process imported `commands/index`. cli.tsx syncs it once at startup for the
  // terminal; a server has to sync it on every config write, because the language
  // can change mid-session from two directions the CLI never sees: the settings
  // panel, and `/config language en` run from the palette itself.
  function syncCatalogLang(setting: unknown): void {
    setLang(resolveLang(String(setting ?? 'auto')))
  }
  syncCatalogLang(config.settings?.language)

  /**
   * The settings bag to write, canonicalized; or a message naming the bad key.
   *
   * Every key the schema describes goes through `coerceSetting` — the same function
   * `setSchemaSetting` calls in commands/index.ts — so `/config thinkingMode deep`
   * and a POST of the same key agree on what is legal, and the value that lands on
   * disk is the *canonical* one (`coerceSetting` returns the entry from `values`,
   * so `chatWidth: 1200` and `chatWidth: '1200'` both store `'1200'`, which is what
   * the schema's default is and what the settings panel compares against). Without
   * this, `POST /api/config {settings:{chatWidth: 720}}` was persisted verbatim and
   * the row in the settings panel showed a number no control can produce.
   *
   * Keys absent from the schema pass through untouched: the bag is deliberately
   * loose (`Record<string, SettingValue>`) and carries web-only extras, per-entry
   * values and keys from older builds. `undefined` is how a client removes a key
   * from the *request*; it is dropped here so the JSON body never carries one into
   * the merge (a merge can add a key but never remove one — see restoreConfig in
   * the test suite for what that costs when a caller forgets).
   */
  function normalizeSettingsPatch(
    settings: Record<string, SettingValue> | undefined,
  ): { settings: Record<string, SettingValue> } | { error: string } {
    const out: Record<string, SettingValue> = {}
    if (!settings || typeof settings !== 'object') return { settings: out }
    for (const [key, raw] of Object.entries(settings)) {
      if (raw === undefined) continue
      const spec = SETTINGS.find((s) => s.key === key)
      if (!spec) {
        out[key] = raw
        continue
      }
      // Through the text form the TUI would have typed, so there is exactly one
      // notion of each value's spelling. `null` is not a value any spec has.
      const asText = raw === null ? '' : String(raw)
      const res = coerceSetting(spec, asText)
      if (!res.ok || res.value === undefined) return { error: `${key}: ${res.error ?? t('set.errNumber', { v: asText })}` }
      out[key] = res.value
    }
    return { settings: out }
  }

  /**
   * The AppConfig fields a browser may write; or a message naming the refused one.
   *
   * `POST /api/config` used to hand its whole parsed body to `updateConfig`, which
   * merges it and persists — so *anything* the body carried became policy for the
   * rest of the session. That is a hole in a server whose `/api/tools/call` runs
   * bash: one POST could set `permissionMode: 'bypassPermissions'`, plant a deny
   * rule, repoint the provider at a different model, or write an `apiKey` (which
   * `saveConfig` drops on the way to disk but which then lives in memory and is
   * carried into every later turn). None of that is a *setting* — those are the
   * `settings` bag above — so the fix is the same one lib/launcher.ts applies to
   * its own config endpoint: name the fields the client legitimately writes and
   * refuse the rest rather than trusting the shape.
   *
   * `permissions` is refused rather than dropped on purpose. The palette's
   * `/permissions …` command reaches the browser through `setConfig`, not through
   * this route, so the panel loses nothing — and a raw rule list is precisely the
   * thing an attacker would want to plant (`deny` is the only list that is safe to
   * invent, but a list nobody in the page chose is a policy the user never set).
   */
  function normalizeConfigPatch(body: Partial<AppConfig>): { patch: Partial<AppConfig> } | { error: string } {
    const WRITABLE = ['provider', 'model', 'theme', 'system'] as const
    const REFUSED = ['apiKey', 'permissions', 'hooks', 'mcpServers', 'customProviders'] as const
    for (const key of REFUSED) {
      if (body[key] !== undefined) {
        return { error: `${key}: not writable over HTTP` }
      }
    }
    const patch: Partial<AppConfig> = {}
    for (const key of WRITABLE) {
      const value = body[key]
      if (value === undefined) continue
      if (key === 'model') patch.model = String(value)
      else if (key === 'provider') patch.provider = String(value)
      else if (key === 'theme') patch.theme = String(value)
      else patch.system = String(value) || undefined
    }
    return { patch }
  }

  // ---- access control ------------------------------------------------------
  //
  // This server reaches ANY tool through `/api/tools/call` (bash included), so
  // reaching the API must require this run's token AND come from our own page.
  // Binding to loopback is not by itself a boundary: any page the user has open
  // can POST to http://127.0.0.1:4040, and a hostname that resolves to 127.0.0.1
  // defeats a socket-level check. So:
  //
  //   - every /api route requires a per-run secret token (the page is served with
  //     it embedded, so a user who opens the printed URL never sees a difference);
  //   - cross-origin requests are refused rather than invited in with `*`;
  //   - the Host header must name the address we bound to (anti DNS-rebinding).
  //
  // This is the token model from origin/main's security pass: a bearer the page
  // embeds for its own calls, plus an origin allowlist and a Host check. Two
  // earlier shapes existed and both left the user with a credential they could not
  // keep: a fragment the page exchanged at POST /api/auth (EventSource cannot send
  // headers, so the cookie had to be persistent), and a bare per-process token
  // (a new URL on every launch). What is here is the union of what survived:
  //
  //   - the token is STABLE across restarts (see token-store.ts), so the printed
  //     URL can be bookmarked and re-opened;
  //   - it rides the URL as a FRAGMENT, which never reaches a proxy log or a
  //     Referer header, and the page spends it locally;
  //   - /api/events keeps accepting `?token=`, which is the one credential an
  //     EventSource can carry (see presentedToken) — so the header/cookie/query
  //     triad stays, and auth.test.ts's assertions are unchanged.
  //
  // `auth: false` is the deliberate "I want this reachable" opt-in. It must never
  // mint or store a credential: that would write the user's real token file for a
  // server that ignores it.
  const requireAuth = options.auth !== false
  const authToken = requireAuth
    ? options.authToken ?? stableWebUIToken(() => crypto.randomBytes(24).toString('base64url'))
    : ''

  const timingSafeEqual = (a: string, b: string): boolean => {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
  }

  // Hostname-only comparison: the request already arrived on OUR socket, so the
  // port adds nothing, while pinning it would break the port-walk fallback below.
  // What matters is the NAME the client used — that is what DNS rebinding forges.
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  const boundLoopback = LOOPBACK.has(host.toLowerCase())

  const nameAllowed = (hostname: string): boolean => {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (boundLoopback) return LOOPBACK.has(h) || LOOPBACK.has(`[${h}]`)
    // A deliberate non-loopback bind answers to that name (and to loopback, since
    // the user can still reach it locally).
    return h === host.toLowerCase() || LOOPBACK.has(h)
  }

  /** Did the client address us by a name we answer to? (anti DNS-rebinding) */
  const hostAllowed = (hdr: string | undefined): boolean => {
    if (!hdr) return false
    // Strip the port; keep IPv6 brackets intact.
    const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hdr.trim())
    return m ? nameAllowed(m[1]) : false
  }

  /** Is this request's Origin our own page (or absent, i.e. not a browser)? */
  const originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin
    if (!origin || origin === 'null') return !origin   // curl/native clients: fine; opaque origin: no
    try { return nameAllowed(new URL(origin).hostname) } catch { return false }
  }

  /**
   * The token a request presents, from the header, a bearer header, the cookie,
   * or the query.
   *
   * The query string is not decoration: `EventSource` cannot set request headers,
   * so /api/events is the one route a browser can only authenticate this way.
   *
   * The COOKIE is the other one, and it is what the fragment→cookie exchange at
   * POST /api/auth exists to produce — the header and the query both require the
   * raw token still to be lying around in the page, while the cookie is the one
   * form that needs nothing from script (hence HttpOnly). A server that has a
   * cookie but refuses to read it would lock out every page that did the
   * exchange properly, which is the whole flow the printed `#token=` URL starts.
   *
   * The order matters for correctness, not tidiness: a caller that presents BOTH
   * an explicit bad credential and a good cookie must be refused. Handing the
   * query/header precedence and dropping the cookie entirely makes an explicit
   * "this token is wrong" behave the same as no credential at all, so the client
   * cannot tell a rejected token from a missing one.
   */
  const presentedToken = (req: IncomingMessage, url: URL): string => {
    const hdr = req.headers['x-meowcode-token']
    if (typeof hdr === 'string' && hdr) return hdr
    const auth = req.headers.authorization
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
    const cookies = req.headers.cookie
    if (cookies) {
      for (const part of cookies.split(';')) {
        const eq = part.indexOf('=')
        if (eq < 0) continue
        if (part.slice(0, eq).trim() === AUTH_COOKIE) {
          const raw = part.slice(eq + 1).trim()
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        }
      }
    }
    return url.searchParams.get('token') ?? ''
  }

  // 30 days: the printed `#token=` URL is meant to be bookmarkable and to survive
  // closing the tab, and the cookie is scoped to this machine's browser profile.
  // It is the SAME trust decision as ~/.meowcode/webui-token holding a stable
  // per-user token (0600) — anyone who can read either can drive the agent — so
  // persisting it does not widen who is authorized, it only stops the browser
  // from asking again on every visit. Without an explicit Max-Age the cookie is a
  // session cookie, and the user's bookmark silently stops working after a
  // browser restart, which is exactly the complaint a stable token was meant to
  // fix. Rotation is "delete ~/.meowcode/webui-token".
  const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60

  const bridge = new AgentBridge(config, cwd)
  const pluginManager = new PluginManager(cwd)

  // Register built-in showcase plugins
  pluginManager.registerPlugin(workspaceFilesPlugin)
  pluginManager.registerPlugin(toolsInspectorPlugin)
  pluginManager.registerPlugin(promptTemplatesPlugin)
  pluginManager.registerPlugin(metricsMonitorPlugin)

  // Register any user-passed plugins
  if (options.plugins) {
    for (const p of options.plugins) {
      pluginManager.registerPlugin(p)
    }
  }

  // Scan external plugins if available
  pluginManager.discoverExternalPlugins()

  // SSE Clients
  const sseClients = new Set<ServerResponse>()

  function broadcastSSE(event: string, data: unknown): void {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of sseClients) {
      try {
        client.write(msg)
      } catch {
        sseClients.delete(client)
      }
    }
  }

  // A turn, run to completion in the background, with its events streamed.
  //
  // Extracted from the /api/turn route because the drain below needs it too: the
  // agent loop only drains `takePending` after a *tool batch*, so a line typed
  // while the model was streaming its final answer is still queued when the turn
  // returns, and nothing else would ever run it. The TUI avoids that by flushing on
  // Esc (app.tsx: "Esc + typed text means say this next, not cancel and forget"); the
  // browser has no such moment, so each leftover becomes a turn of its own here.
  //
  // Sequential, because runTurn refuses a concurrent turn — and one turn per
  // leftover rather than one joined prompt, so the UserPromptSubmit hook sees each
  // prompt the model sees. Capped, so a queue that refills as fast as it drains
  // ends the turn instead of hanging the tab.
  const MAX_DRAINED_TURNS = 8

  async function startTurn(prompt: string, pluginCtx: PluginContext): Promise<void> {
    let next = prompt
    for (let i = 0; i <= MAX_DRAINED_TURNS; i++) {
      let turnResult = { turn: 0 }
      try {
        turnResult = await bridge.runTurn(next, (event) => {
          void pluginManager.onAgentEvent(pluginCtx, event)
          broadcastSSE('agent:event', { event })
        })
      } finally {
        await pluginManager.onTurnEnd(pluginCtx, { turn: turnResult.turn, interrupted: false })
        broadcastSSE('turn:end', { turn: turnResult.turn })
      }
      if (i === MAX_DRAINED_TURNS) break
      const leftover = bridge.drainPending()
      if (leftover.length === 0) break
      next = leftover.join('\n')
      broadcastSSE('turn:start', { prompt: next })
      await pluginManager.onTurnStart(pluginCtx, next)
    }
  }

  function getPluginContext(pluginId: string): PluginContext {
    return {
      pluginId,
      sessionId: bridge.getState().sessionId,
      cwd,
      config: bridge.getConfig(),
      callTool: (name, input) => bridge.runTool(name, input),
      broadcastEvent: (ev, data) => broadcastSSE('plugin:event', { pluginId, event: ev, data }),
    }
  }

  // Interactive prompts (permission allow/deny, ask_user) are raised by the agent
  // loop mid-turn and answered by whoever is looking at the browser. The bridge
  // has no UI, so the server brokers: push the question over SSE, park the
  // promise, and settle it when /api/interaction/respond arrives. This is what
  // lets the WebUI honour the `permissionMode` setting instead of bypassing it.
  //
  // The value is the *request* alongside the resolver, because a second tab (or a
  // reconnect, or a test with no browser at all) has to be able to read a prompt it
  // did not raise. `claimed` is set on the first answer, before the resolver runs,
  // so two tabs racing on the same prompt cannot both resolve it and the loser is
  // told why instead of silently believing it answered.
  const pendingInteractions = new Map<
    string,
    {
      req: WebUIInteraction
      resolve: (res: WebUIInteractionResponse) => void
      claimed?: string
      answer?: WebUIInteractionResponse
      answeredAt?: number
    }
  >()

  // How long an answered prompt stays readable for a retry. Long enough for a
  // client that dropped its response and re-sent, short enough that the map is
  // not a log. Answered entries hold no pending promise, so nothing depends on
  // this being prompt — it only bounds memory and keeps a late second answer
  // distinguishable from an in-flight one.
  const ANSWER_RETENTION_MS = 60_000

  function sameInteractionAnswer(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    const ka = Object.keys(a as Record<string, unknown>).sort()
    const kb = Object.keys(b as Record<string, unknown>).sort()
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
    return ka.every((k) =>
      JSON.stringify((a as Record<string, unknown>)[k]) ===
      JSON.stringify((b as Record<string, unknown>)[k]),
    )
  }

  function answerRetentionSweep(): void {
    if (pendingInteractions.size < 64) return
    const cutoff = Date.now() - ANSWER_RETENTION_MS
    for (const [id, entry] of pendingInteractions) {
      if (entry.answeredAt !== undefined && entry.answeredAt < cutoff) pendingInteractions.delete(id)
    }
  }

  // Marking an entry settled *without* answering it is what stops GET
  // /api/interaction from re-broadcasting a prompt the turn already walked away
  // from. Without it a timed-out or aborted prompt stays pending forever: it is
  // re-sent to every tab on every poll, and the answerRetentionSweep above
  // deliberately spares unanswered entries — they hold the resolver, so a sweep
  // could not drop them even if it wanted to. AnsweredAt is the same field the
  // respond route sets, so the idempotent-retry contract is unchanged: a late
  // answer to a timed-out prompt still gets the 409/200 treatment of an answered
  // one instead of silently re-entering the pending list.
  const markSettled = (id: string, reason: string): void => {
    const entry = pendingInteractions.get(id)
    if (!entry || entry.answeredAt !== undefined) return
    entry.answeredAt = Date.now()
    broadcastSSE('interaction:settled', { id, reason })
  }

  const onInteractionRequest = Object.assign(
    (req: WebUIInteraction) =>
      new Promise<WebUIInteractionResponse>((resolve) => {
        pendingInteractions.set(req.id, { req, resolve })
        broadcastSSE('interaction:request', req)
      }),
    { onSettled: markSettled },
  )

  bridge.setInteractionHandler(onInteractionRequest)

  function parseJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 5 * 1024 * 1024) {
          reject(new Error('Payload too large'))
        }
      })
      req.on('end', () => {
        if (!data) return resolve({})
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.setHeader('Content-Type', 'application/json')
    res.writeHead(statusCode)
    res.end(JSON.stringify(data))
  }

  /**
   * The sentence that stands in for a CommandContext callback with nothing to
   * print. It was a \x00-prefixed sentinel in the printed stream, which reached the
   * transcript as an unprintable glyph inside a document — the transcript renders
   * command output as markdown, and a control character in markdown is not a
   * sentence. Queued beside the stream and substituted here, so /api/commands/run
   * only ever carries text.
   */
  const markerText = (panel: string, lang: Lang): string => {
    const row: MessageEntry | undefined = WEBUI_MESSAGES['palette.openedPanel']
    return interpolate(row ? (row[lang] ?? row.en) : 'Opened the {panel} panel.', { panel })
  }

  /** One registry command, as both faces of the WebUI see it. */
  interface CommandRow {
    name: string
    aliases: string[]
    /** A `cmd.*Desc` catalog key; the route translates it per request. */
    description: string
    /** Bare form refused for want of a terminal-only callback, or already says so. */
    tuiOnly: boolean
    /** Bare form is a stub; it needs an argument to be worth running. */
    requiresArgs: boolean
  }
  type RenderReport = { rows: CommandRow[]; byName: Map<string, boolean> }

  // Languages the index keys off, in catalog order. A registry description is a
  // `t()` call already resolved to one of these two sentences, so scanning the
  // catalog for it finds its key; a /demo Markdown command's prose is in neither
  // column and comes back as itself.
  const KEY_SCAN_LANGS: Lang[] = ['zh', 'en']

  /**
   * The catalog key a description came from, or the description itself.
   *
   * The registry exposes descriptions as `get description() { return t('cmd.xDesc') }`,
   * so the value is a *rendered* sentence, not a key, and it is rendered in whatever
   * language lib/i18n held when the getter ran. Two consequences the index has to
   * absorb: the row carries one reader's language for everyone, and translating it
   * per request (see the /api/commands route) needs the key back. Prose that is not
   * in the catalog has no key to recover, and is kept as-is.
   */
  function descriptionKey(rendered: string): string {
    for (const [key, entry] of Object.entries(tuiMessages as Record<string, MessageEntry>)) {
      for (const lang of KEY_SCAN_LANGS) if (entry[lang] === rendered) return key
    }
    return rendered
  }

  /**
   * Which commands the browser can actually drive — decided by running them.
   *
   * The obvious alternative, scanning `cmd.run.toString()` for `ctx.openThemePicker`,
   * is a guess twice over: it misses a callback held in a variable, and it flags a
   * command that mentions one on a branch a browser never takes. So each command
   * is executed against a CommandContext Proxy shaped like the browser's real one:
   * everything the WebUI implements answers normally, everything else is `undefined`
   * on read, which is what makes each command's own `if (!ctx.openThemePicker)`
   * guard fire exactly as it does in a non-interactive terminal.
   *
   * Read-only-ness comes from the context, not from refusing calls: `config` is a
   * deep copy and `setConfig`/`clear`/`exit` are recorded rather than performed.
   * A command that touches the filesystem directly (saveFeedback, setGoal) is
   * bounded — it only runs when the bare or the arg form reaches that line.
   */
  async function renderCommandIndex(): Promise<RenderReport> {
    const byName = new Map<string, boolean>()
    const rows: RenderReport['rows'] = []

    for (const cmd of registry) {
      const touched: string[] = []
      const printed: Message[] = []

      // A write is recorded, not thrown. Commands mutate the settings bag in place
      // before calling setConfig (`{ ...ctx.config.settings, x: 1 }`), so refusing
      // the call would not keep the probe read-only anyway — the deep copy does
      // that. Letting setConfig resolve lets the command take its real branch,
      // which is the only way to learn where that branch actually leads.
      let wrote = false
      // The properties the spread read on this probe's context. Reassigned per
      // probe, so it has to be `let` and not a const captured by makeContext.
      let read = new Set<string>()

      // A read whose value decides what the bare form does, rather than an action
      // to record. `if (ctx.compact)` and `if (!ctx.openThemePicker)` both read
      // one; giving either the truthy thunk made the command take the browser
      // branch and pass — but the browser has no such callback, so its real run
      // prints "terminal only" instead, and the command then has nothing to ask
      // for either. See COMMAND_CONTEXT_VALUE_MEMBERS in types.ts.
      const booleanReads = new Set<string>(COMMAND_CONTEXT_VALUE_MEMBERS)
      // The pane each openPanel('…') asks for. A bare command whose only action is
      // to switch panes is a no-op in the browser — nothing is listening for a
      // panel here — so it needs the argument that names one.
      const PANEL_TABS = new Set<string>(['config', 'usage', 'status', 'stats'])
      let openPanelTab = ''

      const makeContext = (args: string): CommandContext => {
        const snapshot = JSON.parse(JSON.stringify(bridge.getConfig())) as AppConfig
        const members: Record<string, unknown> = {
          config: snapshot,
          args,
          messages: bridge.getState().messages,
          usage: bridge.getState().usage,
          print: (content: string, role: Role = 'system', meta?: MessageMeta) => {
            printed.push({ id: `render-${printed.length}`, role, content, meta })
          },
          clear: () => {
            wrote = true
          },
          // The browser implements every PanelTab tab, so this callback is real
          // there too — same reasoning the run path uses for openPanel. Which tab
          // it was asked for is recorded, because "switch the panel" is all the
          // bare form does.
          openPanel: (tab: PanelTab) => {
            openPanelTab = tab
          },
          exit: () => {
            wrote = true
            printed.push({ id: 'render-exit', role: 'system', content: tuiMessages['cmd.tuiOnly']?.zh ?? '' })
          },
          // Starting a real turn is the one side effect the recorder cannot
          // undo, so it stays refused — but refused the way the browser refuses
          // it, by returning. Throwing looked stricter and was wrong on both
          // counts: it unwound out of runCommand, so the command's own prints
          // after the send (/init's "running", /review's notice) were lost, and
          // the resulting console.warn per command told the user four commands
          // failed to load when nothing had. A no-op send keeps the rest of the
          // body running, which is what makes those prints evidence: /init,
          // /review and /feedback reach this on the bare form and are complete
          // without an argument, while /plan never does (bare only switches into
          // plan mode) and so needs one.
          send: () => {},
          setConfig: () => {
            wrote = true
          },
        }
        return new Proxy(members, {
          // Reading an unimplemented member records the name and yields a
          // truthy thunk, so the command's own `if (!ctx.openThemePicker)` guard
          // still falls through to its terminal-only branch — the same branch a
          // non-interactive terminal takes. Calling one is what marks the command
          // terminal-only, and merely reading one is not, with one exception:
          // a boolean check is a branch condition rather than an action, so for
          // the few callbacks that are checked and not called (`compact`,
          // `openThemePicker`, `openModelPicker`) it reads undefined, exactly as
          // a browser's would be. Without that, /compact claimed to be runnable
          // here while its real run is a refusal.
          //
          // The thunk answers undefined so a command that calls a callback the
          // browser does lack does not crash on the result; the `touched` record is
          // the signal, and the palette never claims otherwise.
          get(target, prop: string) {
            if (prop in target) return target[prop]
            read.add(prop)
            if (booleanReads.has(prop)) return undefined
            return (...callArgs: unknown[]) => {
              touched.push(prop)
              void callArgs
              return undefined
            }
          },
          // runCommand spreads the context (`cmd.run({ ...ctx, args })`), so the
          // proxy's members have to be own enumerable keys. Without these traps the
          // spread yields a bare object whose every `if (!ctx.openThemePicker)`
          // guard passes, and the probe reports all 47 commands browser-runnable.
          //
          // That spread is an eager Get of every key, which is what `read`
          // records — so it is per-probe, reset in probe() below.
          ownKeys: () => Reflect.ownKeys(members),
          getOwnPropertyDescriptor: () => ({
            ...Object.getOwnPropertyDescriptor(members, 'args'),
            configurable: true,
          }),
          has: () => true,
        }) as unknown as CommandContext
      }

      const probe = async (args: string) => {
        printed.length = 0
        touched.length = 0
        read = new Set()
        openPanelTab = ''
        await runCommand('/' + cmd.name + (args ? ' ' + args : ''), makeContext(args))
        return read
      }

      let tuiOnly = false
      let requiresArgs = false
      try {
        await probe('')
        // A bare /help lists sibling commands and a usage line; those read as
        // errors only by accident, so a non-error result means the command acted.
        const bareError = printed.some((m) => m.meta?.error)
        if (touched.length) {
          tuiOnly = true
        } else if (bareError) {
          await probe('__probe_arg__')
          if (touched.length) tuiOnly = true
          else requiresArgs = true
        } else if (wrote && !printed.length) {
          // No output and a write means the command did the work silently — the
          // bare form is complete. Bare /vim toggles, /clear empties the session.
          requiresArgs = false
        } else if (wrote) {
          // It wrote *and* printed: bare form reports something (a usage line,
          // "already set"). Re-probe with an argument; if that stops reporting
          // the usage complaint, the bare form was the incomplete one.
          wrote = false
          await probe('__probe_arg__')
          if (wrote && !printed.some((m) => m.meta?.error)) requiresArgs = false
          else requiresArgs = true
        }
      } catch (err) {
        // The command failed for a reason unrelated to the probe's context — an
        // async command the snapshot did not satisfy, say. That is not evidence
        // about the browser either way, so it decides nothing; and it must never
        // take the whole index down, or one broken command blanks the palette.
        console.warn(`[webui] command probe failed for /${cmd.name}:`, err)
        requiresArgs = false
      }

      // The browser renders a panel as view state the palette owns, so a bare
      // /usage is the one command whose body *is* openPanel('usage') and has no
      // other effect: no text, no write, nothing to show in the transcript. It is
      // the argument-naming case, not the terminal-only one — a real tab, just not
      // one this endpoint can switch. Checked before tuiOnly so a command that
      // both switches a panel and wants a terminal callback is still called
      // terminal-only.
      if (!tuiOnly && openPanelTab && PANEL_TABS.has(openPanelTab) && !printed.length && !wrote) {
        requiresArgs = true
      }

      byName.set(cmd.name, tuiOnly)
      rows.push({
        name: cmd.name,
        aliases: cmd.aliases ?? [],
        // The catalog key when it is one, the prose otherwise — see
        // descriptionKey. The route translates the key per request so one index
        // serves every reader's language.
        description: descriptionKey(cmd.description),
        tuiOnly,
        requiresArgs,
      })
    }

    return { rows, byName }
  }

  // The probe runs commands, so it is built once at startup rather than per
  // request; a second is cheap enough to allow while the first is still in
  // flight, which is what happens if the browser connects the instant we boot.
  let commandIndex: Promise<RenderReport> | null = null
  function getCommandIndex(): Promise<RenderReport> {
    if (!commandIndex) {
      commandIndex = renderCommandIndex().catch((err) => {
        commandIndex = null
        throw err
      })
    }
    return commandIndex
  }

  async function runBrowserCommand(input: string, lang: Lang): Promise<Message[]> {
    const printed: Message[] = []
    let seq = 0
    // Panels opened are appended after the command's own output, so a command that
    // prints "opening…" and then switches keeps that order.
    const opened: PanelTab[] = []
    const ctx = {
      args: '',
      get config() {
        return bridge.getConfig()
      },
      // A config write goes through the bridge, so the browser, the TUI and
      // /config all see the same file rather than three copies of it.
      setConfig: (patch: Partial<AppConfig>) => {
        const updated = bridge.updateConfig(patch)
        syncCatalogLang(updated.settings?.language)
        broadcastSSE('config:update', updated)
      },
      get messages() {
        return bridge.getState().messages
      },
      clear: () => {
        bridge.resetSession()
        broadcastSSE('session:state', bridge.getState())
      },
      // A side-panel switch is pure view state, and it is one of the callbacks a
      // command may reach for, so it is implemented rather than left out: a
      // browser implements all four PanelTab tabs, which makes /config, /status,
      // /usage and /stats runnable here and keeps the TUI-only marker honest.
      openPanel: (tab: PanelTab) => {
        opened.push(tab)
      },
      exit: () => {
        printed.push({ id: `cmd-${++seq}`, role: 'system', content: tuiMessages['cmd.tuiOnly']?.zh ?? '', meta: { error: true } })
      },
      print: (content: string, role: Role = 'system', meta?: MessageMeta) => {
        printed.push({ id: `cmd-${++seq}`, role, content, meta })
      },
      // A browser turn: the client's `send` submits this as a normal prompt.
      // The bridge is synchronous here — the command itself has already
      // returned to the client — but runTurn can still reject (an empty prompt,
      // a hook failure, or a turn already in progress). Left floating, that
      // rejection is unhandled and kills the process, so the failure is
      // reported over SSE where the rest of the turn's events go.
      send: (text: string) => {
        bridge
          .runTurn(text, (event) => broadcastSSE('agent:event', { event }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            broadcastSSE('agent:event', { event: { type: 'error', message: `Turn failed: ${message}` } })
          })
          .finally(() => broadcastSSE('turn:end', { turn: 0 }))
      },
      usage: bridge.getState().usage,
    } as unknown as Omit<CommandContext, 'args'>

    await runCommand(input, ctx)
    // The browser sends no panel field with /api/commands/run, so it gets a
    // sentence and no panel switch: switching is view state the palette owns.
    for (const tab of opened) {
      printed.push({ id: `cmd-${++seq}`, role: 'system', content: markerText(tab, lang) })
    }
    return printed
  }

  const server = http.createServer(async (req, res) => {
    // Only our own page is a permitted origin — `*` here would let ANY website call
    // /api/tools/call (preflight passed, response readable) on a server that runs
    // tools with bypassPermissions.
    const reqOrigin = req.headers.origin
    const okOrigin = originAllowed(req)
    if (reqOrigin && okOrigin) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MeowCode-Token, Authorization')
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(okOrigin ? 204 : 403)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${host}:${port}`)
    const pathname = url.pathname

    // Anti DNS-rebinding: the browser must have addressed us by the name we bound
    // to. A page on evil.example whose DNS answers 127.0.0.1 arrives with
    // Host: evil.example and is refused here.
    if (!hostAllowed(req.headers.host)) {
      sendJson(res, 403, { error: 'Host not allowed' })
      return
    }
    if (!okOrigin) {
      sendJson(res, 403, { error: 'Origin not allowed' })
      return
    }

    // Server-rendered text follows the configured language; `?lang=` overrides it
    // so the client's /api/i18n fetch and this request cannot disagree about which
    // language a /api/commands/run error is in. The language is read back from the
    // bridge, not from the config object captured at construction: that object is the
    // pre-write snapshot, and updateConfig builds a new one, so a captured reference
    // would keep answering with the language the server booted with.
    const reqLangParam = url.searchParams.get('lang')
    const reqLang: Lang =
      reqLangParam === 'zh' || reqLangParam === 'en'
        ? reqLangParam
        : resolveLang(String(getSetting(bridge.getConfig().settings, 'language') || 'auto'))

    // Everything under /api needs the run's token. The page itself is served
    // without one (it embeds the token for its own later calls).
    const isApi = pathname.startsWith('/api/')
    // TWO routes are exempt, and only these two, because the client cannot
    // present a credential before it has one. The handshake in client/sdk.ts is
    // strictly ordered — scrub the fragment, probe /api/security with no
    // credential at all, then spend the fragment at POST /api/auth — so without
    // these exemptions the page's very first requests 401, `auth.authenticated`
    // never becomes true, and the gate the user is trying to get past is what
    // every printed link lands on. `/api/i18n` is deliberately NOT exempt: the
    // page carries a static boot catalog (html.ts) precisely so a locked first
    // visit can still draw the gate in the right language.
    //
    // Both still pass the Host and Origin checks above, so being public means
    // "no token needed", not "reachable from anywhere".
    const isAuthExchange =
      (req.method === 'POST' && pathname === '/api/auth') ||
      (req.method === 'GET' && pathname === '/api/security')
    if (requireAuth && isApi && !isAuthExchange && !timingSafeEqual(presentedToken(req, url), authToken)) {
      sendJson(res, 401, { error: 'Missing or invalid token. Open the URL printed by MeowCode (it carries #token=…).' })
      return
    }

    try {

      // API: the token exchange — the one route whose BODY carries a credential.
      //
      // This is the first half of the fragment→cookie handshake: the page reads
      // the fragment (never transmitted to us), posts it here, gets an HttpOnly
      // cookie back, and from then on authenticates by cookie — which is what
      // lets EventSource attach a credential at all, since its constructor
      // cannot send headers. Without this route the printed `#token=` URL can
      // never become an authenticated page: the client would hold a token it has
      // no way to spend, and the gate would be the only thing it could render.
      //
      // Deliberately narrow, because it is a public route that grants a
      // credential: a non-empty string `token` only (a number or an object must
      // not pass `String()` into a compare), no fallback to a cookie the body
      // does not carry, and no cookie at all in bypass mode. The Host and Origin
      // checks above already ran, so a hostile page still cannot reach it.
      if (req.method === 'POST' && pathname === '/api/auth') {
        let body: unknown
        try {
          body = await parseJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' })
          return
        }
        const presented = (body as { token?: unknown } | null)?.token
        if (typeof presented !== 'string' || !presented.trim()) {
          sendJson(res, 400, { error: 'token must be a non-empty string' })
          return
        }
        // An explicitly wrong credential is a refusal, never a silent downgrade
        // to whatever cookie the browser happened to still hold.
        if (!timingSafeEqual(presented.trim(), authToken)) {
          sendJson(res, 401, { error: 'Invalid token' })
          return
        }
        res.setHeader('Cache-Control', 'no-store')
        if (requireAuth) {
          res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(authToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}`)
        }
        sendJson(res, 200, { authRequired: requireAuth, bypass: !requireAuth, authenticated: true })
        return
      }

      // API: what the client needs to know to render its auth state honestly.
      //
      // The second half of the handshake, and the reason /api/security is public
      // at all: this is the ONE probe the page makes before it holds any
      // credential, so it is what tells the client "auth is required here" (draw
      // the gate) and "auth is bypassed" (skip the exchange entirely, which is
      // why --no-auth opens with no token at all). `authenticated` is computed
      // from THIS request's own cookie, so a stale one answers false rather than
      // lying. The token itself never appears in the response — only the shape of
      // the requirement.
      if (req.method === 'GET' && pathname === '/api/security') {
        res.setHeader('Cache-Control', 'no-store')
        sendJson(res, 200, {
          authRequired: requireAuth,
          bypass: !requireAuth,
          authenticated: !requireAuth || timingSafeEqual(presentedToken(req, url), authToken),
        })
        return
      }

      // Static Assets
      if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.writeHead(200)
        if (req.method === 'HEAD') return res.end()
        // Inline the catalog the page would otherwise fetch from /api/i18n. That
        // route is behind the token gate, so a LOCKED page cannot reach it — which
        // is why the token gate itself used to render in raw key names. Boot i18n
        // carries the same { lang, messages } shape, resolved to this request's
        // language, so the gate (and the first paint of the whole shell) is
        // translated with no network call. Both languages ride along, so the
        // in-page language switch needs no refetch either.
        const bootI18n = { lang: reqLang, messages: { ...tuiMessages, ...WEBUI_MESSAGES } }
        const html = generateWebUIHtml(pluginManager.getFrontendScripts(), requireAuth ? authToken : '', bootI18n)
        res.end(html)
        return
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/style.css') {
        res.setHeader('Content-Type', 'text/css; charset=utf-8')
        res.writeHead(200)
        if (req.method === 'HEAD') return res.end()
        res.end(CLIENT_CSS)
        return
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/sdk.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.writeHead(200)
        if (req.method === 'HEAD') return res.end()
        res.end(CLIENT_SDK_JS)
        return
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/app.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.writeHead(200)
        if (req.method === 'HEAD') return res.end()
        res.end(CLIENT_APP_JS)
        return
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/material-web.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.writeHead(200)
        if (req.method === 'HEAD') return res.end()
        res.end(MATERIAL_WEB_JS)
        return
      }

      // SSE Stream
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        res.write(':\n\n')
        sseClients.add(res)
        req.on('close', () => {
          sseClients.delete(res)
        })
        return
      }

      // API: Session State
      if (req.method === 'GET' && pathname === '/api/session/state') {
        sendJson(res, 200, bridge.getState())
        return
      }

      // API: Session Reset
      if (req.method === 'POST' && pathname === '/api/session/reset') {
        const state = bridge.resetSession()
        broadcastSSE('session:state', state)
        sendJson(res, 200, state)
        return
      }

      // API: Session List
      if (req.method === 'GET' && pathname === '/api/session/list') {
        sendJson(res, 200, bridge.listSessions())
        return
      }

      // API: Session Load
      if (req.method === 'POST' && pathname === '/api/session/load') {
        const body = await parseJsonBody(req)
        const id = String(body?.id || '')
        const ok = bridge.loadSession(id)
        if (!ok) {
          sendJson(res, 404, { error: 'Session not found' })
          return
        }
        broadcastSSE('session:state', bridge.getState())
        sendJson(res, 200, { ok: true, session: bridge.getState() })
        return
      }

      // API: Session Rename
      if (req.method === 'POST' && pathname === '/api/session/rename') {
        const body = await parseJsonBody(req)
        const id = String(body?.id || '')
        const title = String(body?.title || '').trim()
        if (!id || !title) {
          sendJson(res, 400, { error: 'id and title are required' })
          return
        }
        const ok = bridge.renameSession(id, title)
        if (!ok) {
          sendJson(res, 404, { error: 'Session not found' })
          return
        }
        broadcastSSE('session:state', bridge.getState())
        sendJson(res, 200, { ok: true, id, title })
        return
      }

      // API: Session Delete
      if (req.method === 'POST' && pathname === '/api/session/delete') {
        const body = await parseJsonBody(req)
        const id = String(body?.id || '')
        if (!id) {
          sendJson(res, 400, { error: 'id is required' })
          return
        }
        const ok = bridge.deleteSession(id)
        broadcastSSE('session:state', bridge.getState())
        sendJson(res, 200, { ok })
        return
      }

      // API: Turn (Submit Prompt)
      if (req.method === 'POST' && pathname === '/api/turn') {
        const body = await parseJsonBody(req)
        const prompt = String(body?.prompt || '')
        if (!prompt.trim()) {
          sendJson(res, 400, { error: 'Prompt is required' })
          return
        }

        const pluginCtx = getPluginContext('core')
        await pluginManager.onTurnStart(pluginCtx, prompt)
        broadcastSSE('turn:start', { prompt })

        // Asynchronously run turn and stream events. The caller gets 200 immediately —
        // the events are the answer, delivered over SSE. The `void` needs a catch:
        // runTurn rejects on an empty prompt or a hook failure, and an unhandled
        // rejection would take the whole server process down while the client was
        // told "Turn started".
        void startTurn(prompt, pluginCtx).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[WebUI] turn failed:', message)
          broadcastSSE('agent:event', {
            event: { type: 'error', message: `Turn failed: ${message}` },
          })
          broadcastSSE('turn:end', { turn: 0 })
        })

        sendJson(res, 200, { ok: true, message: 'Turn started' })
        return
      }

      // API: Abort
      if (req.method === 'POST' && pathname === '/api/abort') {
        const result = bridge.abortTurn()
        sendJson(res, 200, result)
        return
      }

      // API: queue a follow-up line for the turn that is streaming right now
      // (the browser analogue of typing ahead in the TUI). The agent loop drains
      // it after the next tool batch via takePending.
      if (req.method === 'POST' && pathname === '/api/turn/queue') {
        const body = await parseJsonBody(req)
        const text = String(body?.text || '')
        if (!text.trim()) {
          sendJson(res, 400, { error: 'Text is required' })
          return
        }
        if (!bridge.queuePending(text)) {
          // A slash command cannot ride a turn as prose, so it runs as its own turn
          // instead — the TUI's idle flush (app.tsx) does the same for the same
          // reason. `send` is wired to /api/turn, so this is a real turn, and
          // /api/turn is the path that runs the UserPromptSubmit hook; feeding the
          // text to the model instead would let it through as model-visible
          // instruction with no hook and no user line behind it.
          const printed = await runBrowserCommand(text, reqLang)
          sendJson(res, 200, { ok: true, ranAsCommand: true, messages: printed })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      }

      // API: answer a pending permission / ask_user prompt (see the broker above)
      if (req.method === 'POST' && pathname === '/api/interaction/respond') {
        const body = await parseJsonBody(req)
        const id = String(body?.id || '')
        // The responder's identity, so two tabs racing on one prompt cannot both
        // see 200 and both believe they allowed the tool while only the first
        // promise was actually settled.
        const who = String(body?.clientId || body?.client || '') || 'anonymous'
        const entry = pendingInteractions.get(id)
        if (!entry) {
          sendJson(res, 404, { error: 'No pending interaction with that id' })
          return
        }
        if (entry.claimed) {
          // Already answered, by this client or another. A client retrying its own
          // request after a dropped response should not be told it failed, so the
          // same identity gets an idempotent 200 — but only if the answer it is
          // repeating matches what already settled it.
          if (entry.claimed === who && entry.answer && sameInteractionAnswer(entry.answer, body?.response)) {
            sendJson(res, 200, { ok: true, alreadyAnswered: true })
            return
          }
          sendJson(res, 409, { error: 'Interaction already answered by another client' })
          return
        }
        // Claim before settling, so a concurrent second answer sees the claim
        // rather than a missing entry. The entry is kept (not deleted) after
        // answering: it is the record of what settled the prompt, which is what
        // makes a repeat from the same client idempotent. It holds no promise any
        // more — the resolver already ran — so it cannot wedge anything, and
        // answerRetentionSweep() drops it.
        entry.claimed = who
        entry.answeredAt = Date.now()
        entry.answer = body?.response as WebUIInteractionResponse
        entry.resolve(entry.answer)
        answerRetentionSweep()
        sendJson(res, 200, { ok: true })
        return
      }

      // API: the parked prompts, so a second tab (or a reconnect, or a test with no
      // browser at all) can answer one it did not raise. Without this the only way
      // to settle a prompt is to have been listening on SSE when it was raised, so
      // closing the tab mid-turn strands the agent until INTERACTION_TIMEOUT_MS
      // fires — and it is the only way to drive a prompt with no browser, since a
      // parked interaction is a promise with nothing else able to settle it.
      // Answered entries are excluded: they hold no pending promise, and listing
      // them would have the client render a dialog for a question that is already
      // answered.
      if (req.method === 'GET' && pathname === '/api/interaction') {
        const pending: string[] = []
        for (const entry of pendingInteractions.values()) {
          if (entry.answeredAt === undefined) {
            pending.push(entry.req.id)
            // Re-broadcast every time. Deduplication belongs to the client, which
            // knows which dialogs *it* already has open — the server cannot, and a
            // server-side "already prompted" flag would starve the second tab, which
            // is exactly the case this route exists for.
            broadcastSSE('interaction:request', entry.req)
          }
        }
        sendJson(res, 200, { pending })
        return
      }

      // API: the settings schema, so the WebUI renders from the same table /config
      // does instead of a hand-maintained parallel list. Labels/descriptions are
      // localized here rather than in the browser — lib/i18n.ts stays React-free
      // precisely so this import is safe.
      if (req.method === 'GET' && pathname === '/api/settings') {
        const lang = reqLang
        // LIVE settings, not the redacted getConfig() one: this route has to see
        // the real credential to compute its marker (below), which is exactly the
        // thing that may not leave the browser. The row's VALUE stays in here —
        // `value` is '' for a secret spec — so the response still carries no key.
        const bag = bridge.liveSettings()
        sendJson(res, 200, {
          lang,
          groups: settingGroups().map((group) => settingGroupLabel(lang, group)),
          settings: SETTINGS.map((spec) => ({
            key: spec.key,
            group: settingGroupLabel(lang, spec.group),
            type: spec.type,
            default: spec.default,
            values: spec.values,
            min: spec.min,
            max: spec.max,
            unit: spec.unit,
            surfaces: spec.surfaces ?? ['tui', 'web'],
            label: settingLabel(lang, spec.key, spec.label),
            description: settingDesc(lang, spec.key, spec.description),
            // A credential leaves the browser with NO value: /api/settings is reachable
            // by anything holding the token, and a settings dump has no business
            // carrying a key. Every other row keeps the live value — the editor
            // feeds `value` straight back — and a secret row renders as a password
            // field carrying only the marker below ("set (13 chars)" / "unset"), so
            // the client never has the key at all.
            value: spec.secret ? '' : getSetting(bag, spec.key),
            display: spec.secret ? formatSettingValue(spec, getSetting(bag, spec.key)) : undefined,
            secret: spec.secret === true,
          })),
        })
        return
      }

      // API: the message catalog, so the browser translates with the same keys as
      // the TUI instead of a second hand-written dictionary. WebUI-only chrome
      // strings (dock hints, welcome cards, panel titles) have no TUI counterpart
      // and ship in client/messages.ts; merging keeps `t()` resolving everything.
      if (req.method === 'GET' && pathname === '/api/i18n') {
        // Same resolution /api/settings uses, so a client that never sends `?lang=`
        // gets the configured language instead of a hardcoded one. The response
        // carries both columns regardless — `lang` is only the row a plugin that
        // wants a single language picks.
        const lang = url.searchParams.get('lang')
        sendJson(res, 200, {
          lang: lang === 'zh' || lang === 'en' ? lang : reqLang,
          messages: { ...tuiMessages, ...WEBUI_MESSAGES },
        })
        return
      }

      // API: the command palette's list — the same registry the TUI autocompletes
      // against, so a slash command added as a Markdown file shows up in the
      // browser too. `tuiOnly` marks the ones whose CommandContext callbacks
      // (overlay pickers, the login panel, the editor) have no browser host; the
      // client offers "copy the CLI command" for those rather than running
      // something that would print "terminal only" and stop.
      if (req.method === 'GET' && pathname === '/api/commands') {
        const index = await getCommandIndex()
        // A localized copy beside the key, never instead of it: the probe ran
        // every command to fill this index, and `/demo` can arrive as a user
        // Markdown command whose `description` is prose rather than a catalog
        // key. translate() falls through to the key, so those rows would come
        // back as "cmd.demoDesc" unless the original string is kept for them.
        sendJson(res, 200, {
          lang: reqLang,
          commands: index.rows.map((r) => {
            const described = translate(reqLang, r.description as MessageKey)
            return { ...r, description: described === r.description ? r.description : described }
          }),
        })
        return
      }

      // API: run a slash command with a browser-backed CommandContext. Output
      // comes back as the array of messages `print` produced, so the client can
      // render it in the transcript.
      if (req.method === 'POST' && pathname === '/api/commands/run') {
        const body = await parseJsonBody(req)
        const input = String(body?.command || '')
        if (!input.trim()) {
          sendJson(res, 400, { error: 'Command is required' })
          return
        }
        const printed = await runBrowserCommand(input, reqLang)
        sendJson(res, 200, { ok: true, messages: printed })
        return
      }

      // API: login state, to pre-fill the browser login dialog. Never returns a
      // key — only whether one is in force and the non-secret base/clientId/user.
      if (req.method === 'GET' && pathname === '/api/login/info') {
        const cur = loadCredentials()
        sendJson(res, 200, {
          baseUrl: cur?.baseUrl || resolveNewapiBase(),
          clientId: resolveOAuthClientId(),
          loggedIn: !!(cur && (cur.key || cur.oauth?.accessToken)),
          how: keySource(),
          as: cur?.session?.username || cur?.oauth?.scope ? cur?.session?.username : undefined,
        })
        return
      }

      // API: run a login. Mirrors the TUI LoginPanel's three methods (paste relay
      // key / username+password[+2FA] / browser OAuth), reusing the same lib/newapi
      // + lib/oauth primitives so the two front-ends can never drift. Credentials
      // are written to ~/.meowcode/credentials.json (0600) and NEVER echoed back.
      if (req.method === 'POST' && pathname === '/api/login') {
        const body = await parseJsonBody(req)
        const method = String(body?.method || '')
        const baseUrl = String(body?.baseUrl || resolveNewapiBase())
        const now = Date.now()
        try {
          if (method === 'key') {
            const key = String(body?.key || '').trim()
            if (!key) { sendJson(res, 400, { error: t('login.errKeyRequired') }); return }
            saveCredentials({ baseUrl: normalizeBase(baseUrl), key, savedAt: now })
            broadcastSSE('config:update', bridge.getConfig())
            sendJson(res, 200, { ok: true })
            return
          }
          if (method === 'password' || method === '2fa') {
            const username = String(body?.username || '').trim()
            const r = method === '2fa'
              ? await submit2FA(baseUrl, String(body?.code || '').trim(), String(body?.flowToken || ''), username)
              : await newapiLogin(baseUrl, username, String(body?.password || ''))
            if (!r.ok) { sendJson(res, 200, { ok: false, error: r.error || t('login.loginFailed') }); return }
            if (r.needs2FA) { sendJson(res, 200, { ok: false, needs2FA: true, flowToken: r.flowToken || '' }); return }
            if (!r.session) { sendJson(res, 200, { ok: false, error: t('login.loginResponseError') }); return }
            const relay = await fetchRelayKey(baseUrl, r.session.accessToken)
            if (!relay) { sendJson(res, 200, { ok: false, error: t('login.noRelayToken') }); return }
            saveCredentials({ baseUrl: normalizeBase(baseUrl), key: relay, session: r.session, savedAt: now })
            broadcastSSE('config:update', bridge.getConfig())
            sendJson(res, 200, { ok: true })
            return
          }
          if (method === 'oauth') {
            const clientId = String(body?.clientId || '').trim() || resolveOAuthClientId()
            const r = await loginWithOAuth({
              baseUrl,
              clientId,
              onStatus: (status) => broadcastSSE('login:oauth', { status }),
              onAuthUrl: (authUrl) => broadcastSSE('login:oauth', { authUrl }),
            })
            if (!r.ok || !r.oauth) { sendJson(res, 200, { ok: false, error: r.error || t('login.oauthFailed') }); return }
            saveCredentials({ baseUrl: normalizeBase(baseUrl), oauth: r.oauth, savedAt: now })
            broadcastSSE('config:update', bridge.getConfig())
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 400, { error: 'Unknown login method' })
        } catch (err: any) {
          sendJson(res, 200, { ok: false, error: err?.message || String(err) })
        }
        return
      }

      // API: log out — revoke the token family best-effort, then wipe the local
      // credential while PRESERVING the hand-typed apiKeySetting (its one home is
      // this same file), exactly as the /logout command does.
      if (req.method === 'POST' && pathname === '/api/logout') {
        const cur = loadCredentials()
        if (cur?.oauth) { try { await revokeOAuth(cur.oauth) } catch { /* best-effort */ } }
        else if (cur?.session) { try { await newapiLogout(cur.baseUrl, cur.session) } catch { /* best-effort */ } }
        const keptKey = loadApiKey()
        clearCredentials()
        if (keptKey) saveApiKey(keptKey)
        broadcastSSE('config:update', bridge.getConfig())
        sendJson(res, 200, { ok: true })
        return
      }

      // API: the REAL callable model list, so /model is not a hardcoded stub. Same
      // source the TUI's model picker uses — GET /v1/models through the resolved
      // relay token (an sk- key, or an OAuth at_ token transparently refreshed),
      // against the credential's base URL. On no login / mock / a network error it
      // returns { models: [], error } and the client falls back to its shortlist.
      if (req.method === 'GET' && pathname === '/api/models') {
        const cur = loadCredentials()
        const base = cur?.baseUrl || resolveNewapiBase()
        let token: string | undefined
        try { token = await resolveRelayToken() } catch { token = undefined }
        const catalog = await fetchModelCatalog(base, token)
        sendJson(res, 200, catalog)
        return
      }

      // API: Config. The theme *names* come from themeList() rather than the
      // SETTINGS row, because the user's own themes are valid values and the
      // schema cannot enumerate them. Read-only enrichment: POST /api/config takes
      // the AppConfig shape and must not learn a `themes` field.
      if (req.method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, {
          ...bridge.getConfig(),
          themes: themeList().map((t2) => ({ name: t2.name, label: t2.title })),
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/config') {
        const body = (await parseJsonBody(req)) as Partial<AppConfig> & {
          settings?: Record<string, SettingValue>
        }
        const allowed = normalizeConfigPatch(body)
        if ('error' in allowed) {
          sendJson(res, 400, { error: allowed.error })
          return
        }
        const normalized = normalizeSettingsPatch(body.settings)
        if ('error' in normalized) {
          sendJson(res, 400, { error: normalized.error })
          return
        }
        const updated = bridge.updateConfig({ ...allowed.patch, settings: normalized.settings })
        // lib/i18n's language is module state, so a language written here is one
        // every later `t()` in this process reads. Syncing it is what makes the
        // settings panel's language dropdown switch the command palette's labels
        // and /api/commands/run's output too, rather than just the chrome.
        syncCatalogLang(updated.settings?.language)
        broadcastSSE('config:update', updated)
        sendJson(res, 200, updated)
        return
      }

      // API: Tools
      if (req.method === 'GET' && pathname === '/api/tools') {
        sendJson(res, 200, { tools: bridge.listTools() })
        return
      }

      if (req.method === 'POST' && pathname === '/api/tools/call') {
        const body = await parseJsonBody(req)
        const name = String(body?.name || '')
        const input = (body?.input || {}) as Record<string, unknown>
        const pluginCtx = getPluginContext('core')

        const intercepted = await pluginManager.onToolCall(pluginCtx, name, input)
        if (intercepted !== undefined) {
          sendJson(res, 200, intercepted)
          return
        }

        // A direct HTTP tool call bypasses the model, so it must pay the same
        // permission price: rules, then the mode decision, then a browser prompt.
        const verdict = await bridge.authorizeToolCall(name, input)
        if (!verdict.allow) {
          sendJson(res, 403, { isError: true, content: verdict.reason })
          return
        }

        const result = await bridge.runTool(name, input)
        sendJson(res, 200, result)
        return
      }

      // API: List Plugins
      if (req.method === 'GET' && pathname === '/api/plugins') {
        sendJson(res, 200, { plugins: pluginManager.listPlugins() })
        return
      }

      // API: Plugin Custom Routes: /api/plugins/:id/:action
      if (pathname.startsWith('/api/plugins/')) {
        const parts = pathname.slice('/api/plugins/'.length).split('/')
        const pluginId = parts[0]
        const action = parts[1] || ''

        if (pluginId && action) {
          const body = req.method === 'POST' ? await parseJsonBody(req) : url.searchParams
          const handled = await pluginManager.handleRoute(
            pluginId,
            action,
            req,
            res,
            body,
            getPluginContext(pluginId),
          )
          if (handled) return
        }
      }

      // 404
      sendJson(res, 404, { error: 'Not found' })
    } catch (err: any) {
      if (!res.writableEnded) {
        sendJson(res, 500, { error: err.message || String(err) })
      }
    }
  })

  let effectivePort = port

  // `listen` is server-internal: it lets tests and startWebUI bind the port
  // themselves. Not part of the public contract — but startWebUI routes EVERY
  // bind through it, including the port-walk retry, because it is the only thing
  // that records the port that was actually bound.
  const instance: WebUIServerInternals = {
    get port() {
      return effectivePort
    },
    get host() {
      return host
    },
    get url() {
      // The token rides the FRAGMENT: a fragment is never sent to the server, so
      // it cannot land in an access log, a proxy log or a Referer header on any
      // outbound link the page makes. The page reads it at boot and spends it (see
      // the handshake in client/sdk.ts); /api/events takes `?token=` because
      // EventSource cannot send headers — see presentedToken.
      const base = `http://${host}:${effectivePort}`
      return requireAuth ? `${base}/#token=${authToken}` : base
    },
    /**
     * The credential this run's /api routes require — empty when `auth: false`,
     * which is what tells a caller there is nothing to hand out. Returning the
     * generated token anyway would print a credential for a server that ignores
     * it, and would leak it to a test asserting that opting out really opts out.
     */
    get token() {
      return requireAuth ? authToken : ''
    },
    /** The same server without the credential — safe to log. */
    get baseUrl() {
      return `http://${host}:${effectivePort}`
    },
    registerPlugin(plugin: WebUIPlugin) {
      pluginManager.registerPlugin(plugin)
    },
    getPlugins() {
      const list = pluginManager.listPlugins()
      const plugins: WebUIPlugin[] = []
      for (const info of list) {
        const p = pluginManager.getPlugin(info.id)
        if (p) plugins.push(p)
      }
      return plugins
    },
    async close() {
      for (const client of sseClients) {
        try {
          client.end()
        } catch {}
      }
      sseClients.clear()
      // A parked interaction is a promise nothing will settle: without a handler
      // installed there is no browser to answer, and /api/tools/call would sit on
      // it for the full 180s timeout. Closing the server is that handler saying
      // "no" — deny every open question, so the waiter resumes and the process can
      // actually exit. (stopMcpServers runs after, not before: a handshake still
      // settling would be holding a connection server.close() waits on.)
      // Only unanswered ones: an answered entry's resolver already ran, and
      // calling it again would be a no-op resolve on a settled promise.
      for (const entry of pendingInteractions.values()) {
        if (entry.answeredAt === undefined) entry.resolve({ decision: 'deny', reason: '服务器已关闭' })
      }
      pendingInteractions.clear()
      bridge.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
    // Internal listen helper
    listen(p: number, onListening?: () => void) {
      effectivePort = p
      server.listen(p, host, onListening)
      return server
    },
  }

  return instance
}

function launchBrowser(url: string): void {
  const start =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open'
  // argv, not a shell string: the URL is built from a configurable host and port,
  // and `exec` would hand both to /bin/sh. The URL is always one we generated,
  // but execFile makes that a fact rather than a promise.
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    execFile(start, args, () => {})
  } catch {
    // Ignore browser open errors
  }
}

// Browser-restricted ports: Chrome/Edge refuse to NAVIGATE to these
// (ERR_UNSAFE_PORT) even though the OS binds them without complaint. The port
// walk below skips them, so it never hands the browser a URL it will reject —
// the user hit exactly this when a walk from 4040 landed on 4045 (lockd) and the
// tab died with ERR_UNSAFE_PORT. This is Chromium's kRestrictedPorts list.
const UNSAFE_PORTS = new Set<number>([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
])
const skipUnsafePort = (p: number): number => {
  let n = p
  while (UNSAFE_PORTS.has(n)) n++
  return n
}

// Exported for the port-walk test — the skip is the thing that keeps the browser
// from being handed an ERR_UNSAFE_PORT URL, and it must not quietly regress.
export const _skipUnsafePortForTest = skipUnsafePort

export async function startWebUI(options: WebUIOptions = {}): Promise<WebUIServerInstance> {
  const initialPort = options.port || 4040
  const host = options.host || '127.0.0.1'
  const instance = createWebUIServer(options)

  return new Promise((resolve, reject) => {
    let currentPort = skipUnsafePort(initialPort)
    // Every bind goes through the instance's own `listen`, which is what records
    // the port it landed on. Calling server.listen directly on a retry left
    // effectivePort naming the port that was ALREADY taken — so instance.url and
    // the announced link both pointed at a server that does not exist, and that
    // link is the only credential the user gets.
    const listen = (instance as WebUIServerInternals).listen
    const server = listen.call(instance, currentPort)

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        const busy = currentPort
        currentPort = skipUnsafePort(currentPort + 1)
        if (currentPort > initialPort + 12) {
          reject(new Error(`Unable to bind WebUI server; ports ${initialPort}-${currentPort} are in use.`))
        } else {
          // Say what happened: the port the user asked for was not the port they
          // got, and without this the walk-up is invisible — they wonder why the
          // printed URL is not the one they configured.
          process.stdout.write(
            `⚠  Port ${busy} is in use, starting WebUI on ${currentPort} instead.\n`,
          )
          listen.call(instance, currentPort)
        }
      } else {
        reject(err)
      }
    })

    server.on('listening', () => {
      // ONE announcement, naming the port instance.url names — both read the same
      // live value now. (Firing it per bind attempt printed the token twice, the
      // second time against a stale port.)
      const base = `http://${host}:${instance.port}`
      if (options.openBrowser !== false) {
        launchBrowser(instance.url)
      }
      if (instance.token) {
        process.stdout.write(
          `🔑 WebUI token (this URL is the only credential; treat it like a password): ${base}/#token=${instance.token}\n`,
        )
      } else {
        process.stdout.write(
          `⚠  Auth bypassed (--no-auth): anyone who can reach ${base} can drive this agent. Origin checks still apply.\n`,
        )
      }
      resolve(instance)
    })
  })
}
