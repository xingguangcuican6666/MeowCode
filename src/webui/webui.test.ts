import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createWebUIServer } from './server'
import type { WebUIServerInstance, WebUIPlugin } from './types'

describe('MeowCode Built-in WebUI & Extension SDK', () => {
  let instance: WebUIServerInstance
  const testPort = 44556

  const customPlugin: WebUIPlugin = {
    id: 'test-custom-plugin',
    name: 'Test Custom Plugin',
    version: '1.0.0',
    description: 'A test plugin validating extension slots and APIs',
    frontendScript: '// Custom plugin script loaded in browser',
    routes: {
      ping: (_req, _res, body) => {
        return { pong: true, received: body }
      },
    },
    onTurnStart: (_ctx, prompt) => {
      // test hook
      if (prompt === 'trigger-error') {
        throw new Error('test turn error')
      }
    },
  }

  beforeAll(async () => {
    instance = createWebUIServer({
      port: testPort,
      host: '127.0.0.1',
      openBrowser: false,
      plugins: [customPlugin],
    })
    await new Promise<void>((resolve) => {
      ;(instance as any).listen(testPort, () => resolve())
    })
  })

  afterAll(async () => {
    if (instance) {
      await instance.close()
    }
  })

  it('serves the main HTML document with reserved extension slots', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()

    // Assert key layout elements & slots are present
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('MeowCode')
    expect(html).toContain('data-slot="header:left"')
    expect(html).toContain('data-slot="header:center"')
    expect(html).toContain('data-slot="header:actions"')
    expect(html).toContain('data-slot="sidebar:header"')
    expect(html).toContain('data-slot="sidebar:nav"')
    expect(html).toContain('data-slot="chat:toolbar"')
    expect(html).toContain('data-slot="chat:input_actions"')
    expect(html).toContain('data-slot="statusbar:left"')
    expect(html).toContain('data-slot="statusbar:right"')
    expect(html).toContain('/sdk.js')
    expect(html).toContain('/app.js')
    expect(html).toContain('/material-web.js')
    expect(html).toContain('md-linear-progress')
    expect(html).toContain('md-filled-button')
    expect(html).toContain('test-custom-plugin')
    expect(html).toContain('id="open-settings-btn"')
    expect(html).toContain('id="settings-modal"')
    expect(html).toContain('class="settings-dialog-card"')
  })

  it('serves CSS design system and JavaScript bundles (including official @material/web)', async () => {
    const cssRes = await fetch(`http://127.0.0.1:${testPort}/style.css`)
    expect(cssRes.status).toBe(200)
    expect(cssRes.headers.get('content-type')).toContain('text/css')
    const css = await cssRes.text()
    expect(css).toContain('--md-sys-color-primary')
    expect(css).toContain('[data-theme="light"]')
    expect(css).toContain('--md-shape-xxl')
    expect(css).toContain('.settings-modal-backdrop')
    expect(css).toContain('.settings-dialog-card')

    const sdkRes = await fetch(`http://127.0.0.1:${testPort}/sdk.js`)
    expect(sdkRes.status).toBe(200)
    expect(sdkRes.headers.get('content-type')).toContain('javascript')
    const sdk = await sdkRes.text()
    expect(sdk).toContain('window.MeowSDK')
    expect(sdk).toContain('theme')
    expect(sdk).toContain('m3')
    expect(sdk).toContain('i18n')

    const appRes = await fetch(`http://127.0.0.1:${testPort}/app.js`)
    expect(appRes.status).toBe(200)
    const app = await appRes.text()
    expect(app).toContain('chat-transcript')
    expect(app).toContain('demo-showcase-btn')
    expect(app).toContain('renderSettingsContent')

    const m3Res = await fetch(`http://127.0.0.1:${testPort}/material-web.js`)
    expect(m3Res.status).toBe(200)
    expect(m3Res.headers.get('content-type')).toContain('javascript')
    const m3Js = await m3Res.text()
    expect(m3Js).toContain('md-filled-button')
  })

  it('provides session state and session reset API', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${testPort}/api/session/state`)
    expect(stateRes.status).toBe(200)
    const state: any = await stateRes.json()
    expect(state).toHaveProperty('sessionId')
    expect(state).toHaveProperty('messages')
    expect(state).toHaveProperty('usage')
    expect(state.isRunning).toBe(false)

    // Reset session
    const resetRes = await fetch(`http://127.0.0.1:${testPort}/api/session/reset`, { method: 'POST' })
    expect(resetRes.status).toBe(200)
    const resetState: any = await resetRes.json()
    expect(resetState.sessionId).toBeDefined()
    expect(resetState.sessionId).not.toBe(state.sessionId)
  })

  it('lists tools and exposes tool schemas', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/tools`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(Array.isArray(data.tools)).toBe(true)
    const toolNames = data.tools.map((t: any) => t.name)
    expect(toolNames).toContain('bash')
    expect(toolNames).toContain('read_file')
  })

  it('lists active backend and frontend plugins', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/plugins`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(Array.isArray(data.plugins)).toBe(true)
    const pluginIds = data.plugins.map((p: any) => p.id)
    expect(pluginIds).toContain('workspace-files')
    expect(pluginIds).toContain('tools-inspector')
    expect(pluginIds).toContain('prompt-templates')
    expect(pluginIds).toContain('metrics-monitor')
    expect(pluginIds).toContain('test-custom-plugin')
  })

  it('routes custom plugin backend actions via /api/plugins/:id/:action', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/plugins/test-custom-plugin/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello from test' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
    expect(data.result).toEqual({
      pong: true,
      received: { message: 'hello from test' },
    })
  })

  it('supports workspace-files explorer plugin route', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/plugins/workspace-files/tree`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.result.items)).toBe(true)
    expect(data.result.items.length).toBeGreaterThan(0)
  })

  it('supports renaming and deleting sessions via API', async () => {
    // 1. Get current session
    const stateRes = await fetch(`http://127.0.0.1:${testPort}/api/session/state`)
    const state: any = await stateRes.json()
    const sid = state.sessionId

    // 2. Rename the session
    const renameRes = await fetch(`http://127.0.0.1:${testPort}/api/session/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid, title: 'Renamed Session Title' }),
    })
    expect(renameRes.status).toBe(200)
    const renameData: any = await renameRes.json()
    expect(renameData.ok).toBe(true)
    expect(renameData.title).toBe('Renamed Session Title')

    // 3. Delete the session
    const deleteRes = await fetch(`http://127.0.0.1:${testPort}/api/session/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid }),
    })
    expect(deleteRes.status).toBe(200)
    const deleteData: any = await deleteRes.json()
    expect(deleteData.ok).toBe(true)
  })
})

