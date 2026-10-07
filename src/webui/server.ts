import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { loadConfig } from '../config'
import { AgentBridge } from './agent-bridge'
import { PluginManager } from './plugin-manager'
import { generateWebUIHtml } from './client/html'
import { CLIENT_CSS } from './client/css'
import { CLIENT_SDK_JS } from './client/sdk'
import { CLIENT_APP_JS } from './client/app'
import { MATERIAL_WEB_JS } from './client/material-web'
import { workspaceFilesPlugin } from './plugins/workspace-files'
import { toolsInspectorPlugin } from './plugins/tools-inspector'
import { promptTemplatesPlugin } from './plugins/prompt-templates'
import { metricsMonitorPlugin } from './plugins/metrics-monitor'
import type { PluginContext, WebUIOptions, WebUIPlugin, WebUIServerInstance } from './types'

export function createWebUIServer(options: WebUIOptions = {}): WebUIServerInstance {
  const cwd = options.cwd || process.cwd()
  const config = options.config || loadConfig()
  const port = options.port || 4040
  const host = options.host || '127.0.0.1'

  // ---- access control ------------------------------------------------------
  //
  // This server drives the agent with bypassPermissions, and `/api/tools/call`
  // reaches ANY tool (bash included). It binds to loopback, but that alone does not
  // make it private: any page the user has open can POST to http://127.0.0.1:4040,
  // and a DNS name that resolves to 127.0.0.1 defeats a socket-level check. So:
  //
  //   - every /api route requires a per-run secret token (the page is served with
  //     it embedded, so a user who opens the printed URL never sees a difference);
  //   - cross-origin requests are refused rather than invited in with `*`;
  //   - the Host header must name the address we bound to (anti DNS-rebinding).
  // The port actually bound (listen() may have walked past a busy one).
  let effectivePort = port
  const authToken = options.authToken ?? crypto.randomBytes(24).toString('base64url')
  const requireAuth = options.auth !== false

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

  /** The token a request presents, from the header or the query string. */
  const presentedToken = (req: IncomingMessage, url: URL): string => {
    const hdr = req.headers['x-meowcode-token']
    if (typeof hdr === 'string' && hdr) return hdr
    const auth = req.headers.authorization
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
    return url.searchParams.get('token') ?? ''
  }

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

  const syncPort = (): void => {
    const addr = serverRef?.address()
    if (addr && typeof addr === 'object' && typeof addr.port === 'number') effectivePort = addr.port
  }
  let serverRef: http.Server | undefined

  const server = http.createServer(async (req, res) => {
    // Only our own page is a permitted origin — `*` here let ANY website call
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
    // Everything under /api needs the run's token. The page itself is served
    // without one (it embeds the token for its own later calls).
    if (requireAuth && pathname.startsWith('/api/') && !timingSafeEqual(presentedToken(req, url), authToken)) {
      sendJson(res, 401, { error: 'Missing or invalid token. Open the URL printed by MeowCode (it carries ?token=…).' })
      return
    }

    try {
      // Static Assets
      if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.writeHead(200)
        if (req.method === 'HEAD') return res.end()
        const html = generateWebUIHtml(pluginManager.getFrontendScripts(), requireAuth ? authToken : '')
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

        // Asynchronously run turn and stream events
        void (async () => {
          let turnResult = { turn: 0 }
          try {
            turnResult = await bridge.runTurn(prompt, (event) => {
              void pluginManager.onAgentEvent(pluginCtx, event)
              broadcastSSE('agent:event', { event })
            })
          } finally {
            await pluginManager.onTurnEnd(pluginCtx, { turn: turnResult.turn, interrupted: false })
            broadcastSSE('turn:end', { turn: turnResult.turn })
          }
        })()

        sendJson(res, 200, { ok: true, message: 'Turn started' })
        return
      }

      // API: Abort
      if (req.method === 'POST' && pathname === '/api/abort') {
        const result = bridge.abortTurn()
        sendJson(res, 200, result)
        return
      }

      // API: Config
      if (req.method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, bridge.getConfig())
        return
      }

      if (req.method === 'POST' && pathname === '/api/config') {
        const body = await parseJsonBody(req)
        const updated = bridge.updateConfig(body)
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

  return {
    get token() {
      return requireAuth ? authToken : ''
    },
    get port() {
      return effectivePort
    },
    get host() {
      return host
    },
    get url() {
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
      bridge.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
    // Internal listen helper. `effectivePort` is refreshed from the socket on every
    // successful bind (startWebUI walks past a busy port by calling server.listen
    // again, which would otherwise leave the recorded port stale).
    listen(p: number, onListening?: () => void) {
      effectivePort = p
      serverRef = server
      server.on('listening', syncPort)
      server.listen(p, host, onListening)
      return server
    },
  } as any
}

function launchBrowser(url: string): void {
  // No shell: `url` is one argv entry (on win32 `cmd /c start` would re-parse '&').
  const p = process.platform
  const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'rundll32' : 'xdg-open'
  const args = p === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => { /* no opener installed — the URL is printed anyway */ })
    child.unref()
  } catch {
    // Ignore browser open errors
  }
}

export async function startWebUI(options: WebUIOptions = {}): Promise<WebUIServerInstance> {
  const initialPort = options.port || 4040
  const host = options.host || '127.0.0.1'
  const instance = createWebUIServer(options)

  return new Promise((resolve, reject) => {
    let currentPort = initialPort
    const server = (instance as any).listen(currentPort)

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        currentPort++
        if (currentPort > initialPort + 10) {
          reject(new Error(`Unable to bind WebUI server; ports ${initialPort}-${currentPort} are in use.`))
        } else {
          server.listen(currentPort, host)
        }
      } else {
        reject(err)
      }
    })

    server.on('listening', () => {
      const url = `http://${host}:${currentPort}`
      if (options.openBrowser !== false) {
        launchBrowser(url)
      }
      resolve(instance)
    })
  })
}
