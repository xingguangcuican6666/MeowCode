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
        let content = p.frontendScript
        // If it looks like a file path that exists, read it
        if (!content.includes('\n') && (content.endsWith('.js') || content.endsWith('.mjs'))) {
          try {
            const resolved = path.isAbsolute(content) ? content : path.join(this.cwd, content)
            if (fs.existsSync(resolved)) {
              content = fs.readFileSync(resolved, 'utf8')
            }
          } catch {
            // fallback to using content as string
          }
        }
        scripts.push({ id: p.id, script: content })
      }
    }
    return scripts
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

  public discoverExternalPlugins(): void {
    const searchDirs = [
      path.join(CONFIG_DIR, 'webui-plugins'),
      path.join(this.cwd, '.meowcode', 'webui-plugins'),
    ]

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) {
            continue
          }
          // Note: In Node ESM, dynamic import can be supported if user provides external plugins
        }
      } catch {
        // ignore scan errors
      }
    }
  }
}
