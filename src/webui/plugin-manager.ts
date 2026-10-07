import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR } from '../lib/configDir'
import type { PluginContext, WebUIPlugin } from './types'
import type { AgentEvent } from '../types'

export interface WebUIPluginInfo {
  id: string
  name: string
  version: string
  description?: string
  hasFrontendScript: boolean
  routes: string[]
}

export class PluginManager {
  private plugins = new Map<string, WebUIPlugin>()
  private cwd: string

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd
  }

  public registerPlugin(plugin: WebUIPlugin): void {
    if (!plugin.id) throw new Error('Plugin id is required')
    this.plugins.set(plugin.id, plugin)
  }

  public unregisterPlugin(id: string): boolean {
    return this.plugins.delete(id)
  }

  public getPlugin(id: string): WebUIPlugin | undefined {
    return this.plugins.get(id)
  }

  public listPlugins(): WebUIPluginInfo[] {
    const list: WebUIPluginInfo[] = []
    for (const p of this.plugins.values()) {
      list.push({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        hasFrontendScript: Boolean(p.frontendScript),
        routes: p.routes ? Object.keys(p.routes) : [],
      })
    }
    return list
  }

  public getFrontendScripts(): Array<{ id: string; script: string }> {
    const scripts: Array<{ id: string; script: string }> = []
    for (const p of this.plugins.values()) {
      if (p.frontendScript) {
        scripts.push({ id: p.id, script: this.readFrontendScript(p) })
      }
    }
    return scripts
  }

  /**
   * `frontendScript` is either inline code or a single-line path ending in
   * .js/.mjs. A path is resolved against the plugin's own `baseDir` first and
   * only then against the workspace cwd — a plugin loaded from disk carries its
   * directory with it, so its assets resolve the same way no matter where the
   * user happened to start the server. That is also the seam a plugin converter
   * or Claude-Code compatibility layer lands on: emit a plugin with `baseDir`
   * pointing at its own tree and its frontend asset just works.
   */
  private readFrontendScript(plugin: WebUIPlugin): string {
    const raw = plugin.frontendScript as string
    if (raw.includes('\n') || !(raw.endsWith('.js') || raw.endsWith('.mjs'))) return raw
    if (path.isAbsolute(raw)) return fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : raw
    const bases = [plugin.baseDir, this.cwd].filter((b): b is string => Boolean(b))
    for (const base of bases) {
      try {
        const resolved = path.resolve(base, raw)
        if (fs.existsSync(resolved)) return fs.readFileSync(resolved, 'utf8')
      } catch {
        // Try the next base; falling through keeps the literal string, which is
        // what a plugin author sees if they meant to inline the code.
      }
    }
    return raw
  }

  public async handleRoute(
    pluginId: string,
    action: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: any,
    ctx: PluginContext,
  ): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin || !plugin.routes) return false
    const handler = plugin.routes[action]
    if (!handler) return false

    try {
      const result = await handler(req, res, body, ctx)
      if (!res.writableEnded) {
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true, result }))
      }
      return true
    } catch (err: any) {
      if (!res.writableEnded) {
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }))
      }
      return true
    }
  }

  public async onTurnStart(ctx: PluginContext, prompt: string): Promise<void> {
    for (const p of this.plugins.values()) {
      if (p.onTurnStart) {
        try {
          await p.onTurnStart(ctx, prompt)
        } catch (e) {
          console.warn(`[Plugin:${p.id}] onTurnStart error:`, e)
        }
      }
    }
  }

  public async onAgentEvent(ctx: PluginContext, event: AgentEvent): Promise<void> {
    for (const p of this.plugins.values()) {
      if (p.onAgentEvent) {
        try {
          await p.onAgentEvent(ctx, event)
        } catch (e) {
          console.warn(`[Plugin:${p.id}] onAgentEvent error:`, e)
        }
      }
    }
  }

  public async onTurnEnd(
    ctx: PluginContext,
    summary: { turn: number; interrupted: boolean },
  ): Promise<void> {
    for (const p of this.plugins.values()) {
      if (p.onTurnEnd) {
        try {
          await p.onTurnEnd(ctx, summary)
        } catch (e) {
          console.warn(`[Plugin:${p.id}] onTurnEnd error:`, e)
        }
      }
    }
  }

  public async onToolCall(
    ctx: PluginContext,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<any> {
    for (const p of this.plugins.values()) {
      if (p.onToolCall) {
        try {
          const res = await p.onToolCall(ctx, toolName, input)
          if (res !== undefined) return res
        } catch (e) {
          console.warn(`[Plugin:${p.id}] onToolCall error:`, e)
        }
      }
    }
    return undefined
  }

  /**
   * The discovery seam for external plugins. Loading them is deliberately out of
   * scope for now, but the scan and the two directories it searches are fixed
   * here so a loader (or a Claude-Code plugin converter, which would translate a
   * manifest into a WebUIPlugin with `baseDir` set) only has to fill in the one
   * step the loop below marks.
   */
  public discoverExternalPlugins(): WebUIPlugin[] {
    const found: WebUIPlugin[] = []
    const searchDirs = [
      path.join(CONFIG_DIR, 'webui-plugins'),
      path.join(this.cwd, '.meowcode', 'webui-plugins'),
    ]

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() && !entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) {
            continue
          }
          // TODO(translator): load `entry` as a WebUIPlugin. The contract is
          // id / name / version / frontendScript (path relative to the plugin's
          // own directory) / routes — set baseDir to the plugin's dir so
          // readFrontendScript resolves its assets there.
        }
      } catch {
        // ignore scan errors
      }
    }
    return found
  }
}
