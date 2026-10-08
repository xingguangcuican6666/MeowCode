import { readFileSync } from 'node:fs'
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'

// Redirect the config directory before anything reads it. `lib/configDir.ts`
// derives CONFIG_DIR from os.homedir() at *import* time, so a vi.mock factory has
// to be hoisted above the imports below and mocking `../config` would never reach
// it. Same trick as entries.test.ts / legacyDir.test.ts / launcher.test.ts, and for
// the same reason: this suite writes config (POST /api/config → saveConfig), and
// without it those writes land in the developer's real ~/.meowcode/settings.json.
// They did — a deny rule survived a suite run once, and no API call could remove it
// afterwards (updateConfig merges).
const { HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'meowcode-webui-')) }
})
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const mocked = { ...actual, homedir: () => HOME } as Omit<typeof actual, 'default'> & { default?: unknown }
  mocked.default = mocked
  return mocked
})

import { createWebUIServer } from './server'
import { SLOT_IDS } from './types'
import type { WebUIPlugin, WebUIServerInstance } from './types'
import { SETTINGS, settingGroups } from '../lib/settings'
import { registry } from '../commands'
import { loadConfig } from '../config'
import { interpolate, messages, settingGroupLabel, settingLabel } from '../lib/i18n'
import { WEBUI_MESSAGES } from './client/messages'
import { generateWebUIHtml } from './client/html'
import { CLIENT_SDK_JS } from './client/sdk'
import { CLIENT_APP_JS } from './client/app'
import { workspaceFilesPlugin } from './plugins/workspace-files'
import { promptTemplatesPlugin } from './plugins/prompt-templates'
import { metricsMonitorPlugin } from './plugins/metrics-monitor'
import { toolsInspectorPlugin } from './plugins/tools-inspector'

// The plugins ship their browser half as a string on the plugin object, exactly
// as PluginManager serves it into a <script> tag.
const workspaceFilesFrontend = workspaceFilesPlugin.frontendScript
const promptTemplatesFrontend = promptTemplatesPlugin.frontendScript
const metricsMonitorFrontend = metricsMonitorPlugin.frontendScript
const toolsInspectorFrontend = toolsInspectorPlugin.frontendScript

/**
 * Lift a top-level `function name(...) { … }` out of the served client string by
 * brace matching, so a test can exercise the real implementation instead of a
 * transcription of it that could drift.
 */
function liftFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`no function ${name} in the client source`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

// escapeHtml is formatMarkdown's only defence, so the pair has to travel together.
const markdownBody = liftFunction(CLIENT_APP_JS, 'escapeHtml') + '\n' + liftFunction(CLIENT_APP_JS, 'formatMarkdown')

describe('MeowCode Built-in WebUI & Extension SDK', () => {
  // The sentence the server substitutes for a side-panel switch, derived from the
  // catalog rather than pasted, so a wording change is one edit in one place.
  const markerTextFor = (panel: string, lang: 'zh' | 'en') =>
    interpolate(WEBUI_MESSAGES['palette.openedPanel'][lang], { panel })

  let instance: WebUIServerInstance
  const testPort = 44556

  // The server requires this run's token on every /api route (see server.ts).
  // The served page embeds it; a test client passes it explicitly.
  const api = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${testPort}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-MeowCode-Token': instance.token, ...(init.headers ?? {}) },
    })

  // Convenience wrappers for the common cases so the 90 call sites stay readable
  const get = (path: string) => api(path)
  const post = (path: string, body?: unknown, extra: Record<string, string> = {}) =>
    api(path, {
      method: 'POST',
      headers: extra,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  /**
   * A config write, undone exactly.
   *
   * `AgentBridge.updateConfig` merges (`{...old, ...patch}`), so a `finally` that
   * posts `{x: undefined}` cannot remove anything — an absent patch key is simply
   * not there to copy. That has bitten this suite twice now: once writing
   * `{"deny":["bash"]}` into the real ~/.meowcode/settings.json for the rest of the
   * day, and once leaving a planted deny rule behind for every later test. So a
   * test that writes config states the whole field it is replacing, and this helper
   * puts that field back.
   *
   * It can only put back what `POST /api/config` accepts — the four plain fields
   * plus the settings bag. `permissions` is not among them (the route refuses rule
   * lists; see the test that says so), which is why the deny-rule test removes its
   * rule with `/permissions remove` instead of calling this.
   */
  const restoreConfig = async (before: Record<string, unknown>): Promise<void> => {
    const fields = ['provider', 'model', 'theme', 'system']
    const patch: Record<string, unknown> = {}
    for (const f of fields) if (f in before) patch[f] = (before as any)[f]
    if ('settings' in before) patch.settings = (before as any).settings
    await post('/api/config', patch)
    const after: any = await (await get('/api/config')).json()
    for (const f of Object.keys(patch)) {
      if (f === 'settings') continue
      expect(after[f], `${f} should be restored`).toEqual((before as any)[f])
    }
    if ('settings' in before) expect(after.settings).toEqual((before as any).settings)
  }

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
    // The suite's own config, not whatever the machine holds. Two reasons, and the
    // second is the one that bites: createWebUIServer falls back to loadConfig() —
    // so a permissionMode of `plan` makes every read-only tool call wait on a
    // permission prompt that has no browser to answer it, and the test hangs rather
    // than fails.
    //
    // `permissions` is seeded with an explicit empty list rather than left absent,
    // because the deny test has to put it back afterwards and a JSON body cannot
    // express "remove this key" — `JSON.stringify({permissions: undefined})` drops
    // it, so updateConfig's merge never sees it. A start value that is *present*
    // and *inert* is what makes the restore complete and checkable.
    instance = createWebUIServer({
      port: testPort,
      host: '127.0.0.1',
      openBrowser: false,
      config: {
        ...loadConfig(),
        permissions: { deny: [] },
        settings: { ...loadConfig().settings, permissionMode: 'default' },
      },
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

  it('mounts every reserved extension slot declared in SLOT_IDS', async () => {
    // The static document carries the chrome slots; the per-message ones are
    // created by app.ts when a row is appended, so assert their creation there.
    const res = await fetch(`http://127.0.0.1:${testPort}/`)
    const html = await res.text()
    const appJs = await (await fetch(`http://127.0.0.1:${testPort}/app.js`)).text()

    const missing = SLOT_IDS.filter((id) => {
      const mount = `data-slot="${id}"`
      return !html.includes(mount) && !appJs.includes(mount)
    })
    expect(missing).toEqual([])
  })

  it('serves CSS design system and JavaScript bundles (including official @material/web)', async () => {
    const cssRes = await fetch(`http://127.0.0.1:${testPort}/style.css`)
    expect(cssRes.status).toBe(200)
    expect(cssRes.headers.get('content-type')).toContain('text/css')
    const css = await cssRes.text()
    expect(css).toContain('--md-sys-color-primary')
    expect(css).toContain('[data-theme="light"]')
    expect(css).toContain('--md-shape-xxl')
    // Settings is a .modal-backdrop with a modifier, not a second backdrop class.
    expect(css).toContain('.modal-backdrop-settings')
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
    // The settings pane is schema-driven now, so it must read /api/settings.
    expect(app).toContain('renderSettingsPane')

    const m3Res = await fetch(`http://127.0.0.1:${testPort}/material-web.js`)
    expect(m3Res.status).toBe(200)
    expect(m3Res.headers.get('content-type')).toContain('javascript')
    const m3Js = await m3Res.text()
    expect(m3Js).toContain('md-filled-button')
  })

  it('provides session state and session reset API', async () => {
    const stateRes = await api(`/api/session/state`)
    expect(stateRes.status).toBe(200)
    const state: any = await stateRes.json()
    expect(state).toHaveProperty('sessionId')
    expect(state).toHaveProperty('messages')
    expect(state).toHaveProperty('usage')
    expect(state.isRunning).toBe(false)

    // Reset session
    const resetRes = await api(`/api/session/reset`, { method: 'POST' })
    expect(resetRes.status).toBe(200)
    const resetState: any = await resetRes.json()
    expect(resetState.sessionId).toBeDefined()
    expect(resetState.sessionId).not.toBe(state.sessionId)
  })

  it('lists tools and exposes tool schemas', async () => {
    const res = await api(`/api/tools`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(Array.isArray(data.tools)).toBe(true)
    const toolNames = data.tools.map((t: any) => t.name)
    expect(toolNames).toContain('bash')
    expect(toolNames).toContain('read_file')
  })

  it('lists active backend and frontend plugins', async () => {
    const res = await get('/api/plugins')
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
    const res = await post('/api/plugins/test-custom-plugin/ping', { message: 'hello from test' })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
    expect(data.result).toEqual({
      pong: true,
      received: { message: 'hello from test' },
    })
  })

  it('supports workspace-files explorer plugin route', async () => {
    const res = await post('/api/plugins/workspace-files/tree')
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.result.items)).toBe(true)
    expect(data.result.items.length).toBeGreaterThan(0)
  })

  it('claims the turn slot before the first await, so two turns cannot interleave', () => {
    // The regression this guards is a race, not a value: `if (this.controller)`
    // used to be the guard, but runTurn awaits two hook runs before it creates
    // that controller, so two simultaneous POST /api/turn requests both sailed
    // past the check and interleaved two turns into one transcript — each one's
    // tool calls racing the other's. A test cannot schedule two requests into the
    // same tick through the HTTP server and get a deterministic interleaving, so
    // what is asserted here is the *structure* that closes the window: the claim
    // is taken synchronously at the top of runTurn, before the first await, and
    // released in a finally that wraps the whole turn.
    const src = readFileSync(new URL('./agent-bridge.ts', import.meta.url), 'utf8')
    const runTurn = src.slice(src.indexOf('public async runTurn('), src.indexOf('private async runTurnAdmitted('))

    // The guard reads the claim flag, not the controller. (The comment in that
    // function quotes the old check on purpose, so only the code lines count.)
    expect(runTurn).toContain('if (this.turnActive) throw new Error')
    expect(runTurn.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')).not.toContain('if (this.controller)')
    // It is set on the line after the check, with no await in between — that is
    // the whole point: nothing can interleave between test and set.
    const check = runTurn.indexOf('if (this.turnActive) throw')
    const claim = runTurn.indexOf('this.turnActive = true')
    expect(claim).toBeGreaterThan(check)
    expect(runTurn.slice(check, claim)).not.toContain('await')
    // And the whole admitted turn runs inside a try that gives the claim back.
    expect(runTurn).toMatch(/this\.turnActive = true[\s\S]*try \{[\s\S]*finally \{[\s\S]*this\.turnActive = false/)
  })

  it('releases the turn claim on every exit, including the ones with no controller', () => {
    // The flag only makes sense if every exit clears it. The path that matters is
    // the one that returns *before* any controller exists: the UserPromptSubmit
    // hook denial, and the empty-prompt rejection. A bridge that kept the claim
    // there would refuse every subsequent turn for the life of the process.
    // Waiting on a real turn to finish is timing-dependent, so the structure is
    // what gets asserted: the finally that clears the claim wraps the *whole*
    // admitted turn, not just the streaming part.
    const src = readFileSync(new URL('./agent-bridge.ts', import.meta.url), 'utf8')
    const runTurn = src.slice(src.indexOf('public async runTurn('), src.indexOf('private async runTurnAdmitted('))
    // `takeEvents` is the last method declared before runTurn, so slicing between
    // the two signatures bounds the admitted half exactly — `src.indexOf('}')`
    // here would land on the first brace in the file, hundreds of lines up.
    const admitted = src.slice(src.indexOf('private async runTurnAdmitted('), src.lastIndexOf('\n}'))
    const afterClaim = runTurn.slice(runTurn.indexOf('this.turnActive = true'))

    // One clear, in the finally that wraps the whole admitted turn, so the
    // returns that happen before a controller ever exists (the hook denial below)
    // still give the claim back.
    expect(runTurn.match(/this\.turnActive = false/g) || []).toHaveLength(1)
    expect(afterClaim).toMatch(
      /^this\.turnActive = true\s*\n\s*try \{[\s\S]*\n\s*\} finally \{[\s\S]*this\.turnActive = false[\s\S]*\}\s*\}\s*$/,
    )
    // That early return lives inside the try, which is the property under test.
    expect(admitted).toMatch(/if \(ups\.decision === 'deny'[\s\S]{0,400}?return \{ turn:/)
    // The flag is read by getState()'s isRunning, so an honest report depends on
    // it being the single source of truth.
    expect(src).toContain('isRunning: this.turnActive')
  })

  it('reports a rejected turn over SSE instead of leaving it unhandled', () => {
    // /api/turn answers 200 immediately and streams the result, so a turn that
    // rejects (empty prompt, hook failure, a turn already running) had nowhere to
    // report itself: the rejection was unhandled, and an unhandled rejection takes
    // the whole server process down while the client had been told "Turn started".
    // Both fire-and-forget call sites now catch and broadcast.
    const serverSrc = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')

    // The /api/turn drain: catch attached, and the failure is surfaced.
    expect(serverSrc).toMatch(/void startTurn\([\s\S]{0,400}?\)\.catch\(/)
    expect(serverSrc).toContain('[WebUI] turn failed:')

    // The browser-command ctx.send: same treatment, one call chain.
    const sendCtx = serverSrc.slice(serverSrc.indexOf('send: (text: string) =>'))
    expect(sendCtx).toMatch(/\.catch\(/)
    expect(sendCtx).toContain('Turn failed:')
  })

  it('reaps a parked interaction the turn walked away from', async () => {
    // A prompt that times out or is aborted used to stay pending forever: the
    // sweep deliberately spares unanswered entries (they hold the resolver), and
    // so GET /api/interaction re-broadcast it to every tab on every poll. The
    // bridge now reports the settlement, and the client closes the dead dialog.
    const serverSrc = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')
    const bridgeSrc = readFileSync(new URL('./agent-bridge.ts', import.meta.url), 'utf8')

    // Bridge: every exit from `ask` reports, not just the answered one.
    const ask = bridgeSrc.slice(bridgeSrc.indexOf('private async ask('), bridgeSrc.indexOf('private takeEvents('))
    expect(ask).toContain('onSettled')
    expect(ask).toMatch(/settle\('answered'\)/)
    expect(ask).toMatch(/settle\('timeout'\)/)
    expect(ask).toMatch(/settle\('aborted'\)/)
    expect(ask).toMatch(/settle\('error'\)/)

    // Server: settled-without-answering sets the same field respond() sets, which
    // is what takes the entry out of the pending list.
    expect(serverSrc).toContain('interaction:settled')
    const mark = serverSrc.slice(serverSrc.indexOf('const markSettled'), serverSrc.indexOf('bridge.setInteractionHandler'))
    expect(mark).toContain('entry.answeredAt = Date.now()')

    // Client: closes the dialog instead of leaving a dead button and re-opening it
    // on the next poll.
    expect(CLIENT_APP_JS).toContain("sse.addEventListener('interaction:settled'")
  })

  it('unwraps the plugin route envelope exactly once, in the SDK', async () => {
    // The server wraps every plugin route result as {ok, result} — the two
    // tests above assert that shape. The SDK is where it comes off again, and
    // getting *that* wrong is silent rather than loud: an unwrapped
    // callBackendPlugin hands the caller the wrapper, so `.items` reads
    // undefined and the Files panel renders an empty list instead of an error.
    // (That was a real bug — the panel was empty for every workspace.)
    const res = await post('/api/plugins/workspace-files/tree')
    const data: any = await res.json()

    // The served SDK text: unwrap present, and exactly one unwrap — two would
    // read `.result` off an already-unwrapped payload and hand back undefined.
    const unwraps = CLIENT_SDK_JS.match(/hasOwnProperty\.call\(\s*\w+\s*,\s*['"]result['"]\s*\)/g) || []
    expect(unwraps.length).toBe(1)
    expect(CLIENT_SDK_JS).toContain('return res.result')

    // And the shape has to keep meaning what the server says it means, since the
    // unwrap keys off `ok === false` / hasOwnProperty('result').
    expect(data).toHaveProperty('result')
    expect(data.result).not.toHaveProperty('result')

    // The client call sites read the payload, not the wrapper.
    expect(workspaceFilesFrontend).toContain('res.items')
    expect(workspaceFilesFrontend).not.toContain('res.result.items')
  })

  it('serves a hostile plugin frontend as inert script text', async () => {
    // Plugins reach the browser as an inline <script> whose body is the plugin's
    // own source, so a hostile (or merely careless) plugin file would otherwise
    // close the tag early and take over the page — including the origin that
    // holds the auth cookie. Server-side JS already grants plugins the full API
    // surface, so this is not about sandboxing a plugin; it is that *breaking
    // out of the script element* is a strictly worse failure than the contract
    // already allows, and it lets a stray `</script>` in a comment corrupt the
    // whole page rather than just that plugin.
    // Written with String.fromCharCode so the payload really does carry a raw
    // `</script` — writing it as a literal here is what the escape test forbids.
    const CLOSE = String.fromCharCode(60, 47) + 'script>'
    const hostile = [
      '// a comment mentioning ' + CLOSE + ' should not end this block',
      'const s = "<" + "/scr" + "ipt>"; console.log(s);',
      'console.log("' + CLOSE + '<img src=x onerror=alert(1)>");',
    ].join('\n')
    const plugin: WebUIPlugin = {
      id: 'hostile-frontend',
      name: 'Hostile Frontend Probe',
      version: '1.0.0',
      description: 'Asserts inline plugin scripts cannot break out of their <script>',
      frontendScript: hostile,
    }
    const html = generateWebUIHtml([{ id: plugin.id, script: plugin.frontendScript as string }])

    // The element's own closing tag must come after every line of the plugin.
    // Not the *first* close in the document — the shell's own <script src> tags
    // come earlier, and the plugin block is injected near the end of <body>. It
    // is also not the *last*: app.js's closing tag follows it.
    const pluginAt = html.indexOf('<!-- Plugin: ' + plugin.id + ' -->')
    expect(pluginAt).toBeGreaterThan(-1)
    const closeTag = html.indexOf('</' + 'script>', pluginAt)
    expect(closeTag).toBeGreaterThan(pluginAt)

    // Everything the payload tried to smuggle out is still inside the script
    // body, and none of it became markup. What terminates an inline script
    // element is a `<` immediately followed by `/script`, so that is the run the
    // plugin half of the block must not contain anywhere: every one of them was
    // rewritten to `<\/script`, which a JS parser reads identically but a tag
    // parser cannot match. (A plain `contains('</script')` test would pass either
    // way — the escaped form still contains that substring — so the assertion is
    // written as `<` + `/` to say the thing that actually matters. What survives is
    // the closing tag the template appends, which is why the slice stops short.)
    const body = html.slice(pluginAt, closeTag)
    expect(body).toContain('<\\/script>')
    expect(body.replace(/<\\\/script/gi, '')).not.toContain('<' + '/' + 'script')
    expect(html.slice(closeTag)).not.toContain('<img src=x')

    // And the rewrite is a no-op to JavaScript: `\/` is an identity escape inside
    // a string literal, so a plugin that legitimately embeds the closing tag as
    // data still sees exactly what it wrote.
    const run = new Function('return "a<\\/script>b";') as () => string
    expect(run()).toBe('a</script>b')
  })

  it('supports renaming and deleting sessions via API', async () => {
    // 1. Get current session
    const stateRes = await get('/api/session/state')
    const state: any = await stateRes.json()
    const sid = state.sessionId

    // 2. Rename the session
    const renameRes = await post('/api/session/rename', { id: sid, title: 'Renamed Session Title' })
    expect(renameRes.status).toBe(200)
    const renameData: any = await renameRes.json()
    expect(renameData.ok).toBe(true)
    expect(renameData.title).toBe('Renamed Session Title')

    // 3. Delete the session
    const deleteRes = await post('/api/session/delete', { id: sid })
    expect(deleteRes.status).toBe(200)
    const deleteData: any = await deleteRes.json()
    expect(deleteData.ok).toBe(true)
  })

  it('serves the settings schema so the WebUI renders the same rows /config does', async () => {
    const res = await get('/api/settings')
    expect(res.status).toBe(200)
    const data: any = await res.json()

    // Every spec from the single SETTINGS table, with a live value and a surface.
    expect(data.settings).toHaveLength(SETTINGS.length)
    expect(data.groups).toEqual(settingGroups().map((g) => settingGroupLabel(data.lang, g)))

    const autoCompact = data.settings.find((s: any) => s.key === 'autoCompact')
    expect(autoCompact.type).toBe('boolean')
    expect(autoCompact.surfaces).toEqual(['tui', 'web'])
    expect(autoCompact.value).toBe(true)
    // Labels come back localized, from lib/i18n's per-setting table.
    expect(autoCompact.label).toBe(settingLabel(data.lang, 'autoCompact', 'Auto-compact'))

    // A web-only row must be marked so the WebUI can render it and /config can skip it.
    const chatWidth = data.settings.find((s: any) => s.key === 'chatWidth')
    expect(chatWidth.surfaces).toEqual(['web'])

    // Both surfaces write into the same bag, so a value set here is readable back.
    const before = (await (await get('/api/config')).json() as any).settings?.verbose
    const patch = await post('/api/config', { settings: { verbose: !before } })
    expect(patch.status).toBe(200)
    const reread: any = await (await get('/api/settings')).json()
    const after = reread.settings.find((s: any) => s.key === 'verbose')
    expect(after.value).toBe(!before)

    // The endpoint and the key are both settable from either surface, and the key
    // never crosses the wire: it goes out masked, in a `display` field.
    const secretRow = reread.settings.find((s: any) => s.key === 'apiKeySetting')
    expect(secretRow.secret).toBe(true)
    expect(['unset', 'set (0 chars)']).toContain(secretRow.display)
    expect(JSON.stringify(secretRow)).not.toMatch(/sk-/)
    const keyRes = await post('/api/config', { settings: { apiKeySetting: 'sk-test-value' } })
    expect(keyRes.status).toBe(200)
    const withKey: any = await (await get('/api/settings')).json()
    const set = withKey.settings.find((s: any) => s.key === 'apiKeySetting')
    expect(set.display).toBe('set (13 chars)')
    expect(JSON.stringify(set)).not.toContain('sk-test-value')
    await post('/api/config', { settings: { apiKeySetting: '' } })

    const baseRes = await post('/api/config', { settings: { apiBaseUrl: 'https://relay.example.com' } })
    expect(baseRes.status).toBe(200)
    const withBase: any = await (await get('/api/settings')).json()
    expect(withBase.settings.find((s: any) => s.key === 'apiBaseUrl').value).toBe('https://relay.example.com')
    await post('/api/config', { settings: { apiBaseUrl: '' } })
  })

  it('serves the shared message catalog so the browser stops shipping its own', async () => {
    const res = await get('/api/i18n?lang=zh')
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.lang).toBe('zh')
    expect(Object.keys(data.messages).length).toBe(
      Object.keys({ ...messages, ...WEBUI_MESSAGES }).length,
    )
    expect(data.messages['app.retryLine']).toEqual(messages['app.retryLine'])

    // With no `?lang=`, the response follows the configured language — the same
    // resolution /api/commands and /api/settings use, so a client that never sends
    // the parameter is not silently handed English on a zh install.
    const configured: any = await (await get('/api/i18n')).json()
    expect(['zh', 'en']).toContain(configured.lang)
    const zh: any = await (await get('/api/i18n?lang=zh')).json()
    const en: any = await (await get('/api/i18n?lang=en')).json()
    expect([zh.lang, en.lang].sort()).toEqual(['en', 'zh'])
    // Both languages ship in one reply, so the two rows differ only in `lang`.
    expect(en.messages['app.retryLine']).toEqual(zh.messages['app.retryLine'])
  })

  it('has a translation for every key the client actually asks for', async () => {
    const catalog: Record<string, unknown> = { ...messages, ...WEBUI_MESSAGES }
    const html = generateWebUIHtml([])
    const clientJs = CLIENT_SDK_JS + CLIENT_APP_JS

    // Three ways the client names a key: declarative attributes, and two calls.
    // `sdk.i18n.t('k')` is a translation; `emit('turn:start')` / `on('theme:change')`
    // are event-bus names that happen to look the same, so match on the receiver.
    const wanted = new Set<string>()
    for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) wanted.add(m[1])
    for (const m of clientJs.matchAll(/sdk\.i18n\.t\(\s*'([^']+)'/g)) wanted.add(m[1])
    for (const m of clientJs.matchAll(/\bt\(\s*'([^']+)'\s*,/g)) wanted.add(m[1])
    for (const m of clientJs.matchAll(/\bt\('([^']+)'\)/g)) wanted.add(m[1])

    // A key with no row renders as its own id in the UI — silent, so assert it.
    const missing = [...wanted].filter((k) => !(k in catalog)).sort()
    expect(missing).toEqual([])
    expect(wanted.size).toBeGreaterThan(50)
  })

  it('moves the server-side catalog when the language setting changes', async () => {
    // A language written through the settings row has to move the *server's* catalog
    // too, not just the next HTTP response: every `t()` inside a command body reads
    // lib/i18n's module-level language, so a client that rendered Chinese while the
    // palette's own sentences stayed English would be two languages at once. The
    // command description is the probe, because it is produced by exactly that `t()`.
    const described = async () => {
      const rows: any = await (await get('/api/commands')).json()
      return rows.commands.find((r: any) => r.name === 'help')?.description as string
    }
    const before = await described()
    try {
      const bag = (((await (await get('/api/config')).json()) as any).settings ?? {}) as Record<string, unknown>
      await post('/api/config', { settings: { ...bag, language: 'en' } })
      const english = await described()
      await post('/api/config', { settings: { ...bag, language: 'zh' } })
      const chinese = await described()

      // The stored value is the canonical one, and the sentences really are the
      // catalog's two rows rather than a coincidence.
      expect(((await (await get('/api/config')).json()) as any).settings.language).toBe('zh')
      expect(english).toBe((messages['cmd.helpDesc'] as { zh: string; en: string }).en)
      expect(chinese).toBe((messages['cmd.helpDesc'] as { zh: string; en: string }).zh)
      expect(english).not.toBe(chinese)
      expect(before).toBe(chinese)
    } finally {
      const bag = (((await (await get('/api/config')).json()) as any).settings ?? {}) as Record<string, unknown>
      await post('/api/config', { settings: bag })
    }
  })

  it('escapes every HTML sink the client builds from untrusted text', () => {
    // The client is served as a raw string with no module graph, so there is no
    // way to drive the DOM here — but the rule it has to obey is mechanical:
    // every ${...} interpolated *into a tag* must be escaped, unless it is
    // structural (a class chosen from a fixed set in that same function, a number
    // the file computed). Model prose, tool output, workspace filenames, plugin
    // labels, sub-agent fields over SSE and config names are all
    // attacker-influenceable — a cloned repo can carry a filename — so a bare
    // interpolation at a sink is the shape of the bug, and this asserts it
    // cannot come back.
    const sources: Array<[string, string]> = [
      ['app.ts', CLIENT_APP_JS],
      ['sdk.ts', CLIENT_SDK_JS],
      ['workspace-files.ts', workspaceFilesFrontend ?? ''],
      ['prompt-templates.ts', promptTemplatesFrontend ?? ''],
      ['metrics-monitor.ts', metricsMonitorFrontend ?? ''],
      ['tools-inspector.ts', toolsInspectorFrontend ?? ''],
    ]

    // A tag's attribute list can hold a ">" inside a quoted value, so match the
    // tag loosely and let the inner scan decide what is really inside it.
    const TAG = /<[a-zA-Z][^<>]*>/g
    // Values that are structure, not text. Each is a literal or a value computed
    // in the same expression from a boolean/arithmetic comparison — never a
    // string that arrived over the wire.
    const STRUCTURAL = [
      'class', 'tagClass', 'state', 'status', 'sel', 'st', 'icon', 'iconName',
      'sizeStr', 'statusLabel', 'lang', 'code', 'lineCount', 'percent',
      'cur', 'min', 'max', 'step', 'n', 'doneCount', 'totalCount',
      'disabled', 'on', 'dirty', 'isActive', 'tuiOnly', 'isDone', 'isProg',
      'isError', 'isSample', 'st ===', 'isErr',
    ]
    const isStructural = (expr: string): boolean => {
      const v = expr.trim()
      if (STRUCTURAL.some((s) => v === s)) return true
      // A conditional that only ever picks literals or a class name: `x ? 'a' : 'b'`.
      if (/^[A-Za-z_$][\w$.]*\s*\?\s*'[^']*'\s*:\s*('[^']*'|[\w$.]+)\s*$/.test(v)) return true
      // Arithmetic on numbers this file already computed.
      if (/^[A-Za-z_$][\w$.]*(\s*[+\-*/]\s*[A-Za-z_$][\w$.]*)*$/.test(v)) return true
      return false
    }

    const offenders: string[] = []
    for (const [name, source] of sources) {
      source.split('\n').forEach((line, i) => {
        if (!line.includes('${')) return
        for (const tag of line.matchAll(TAG)) {
          for (const e of tag[0].matchAll(/\$\{([^}]*)\}/g)) {
            const value = e[1].trim()
            if (/escapeHtml\s*\(/.test(value)) continue
            if (isStructural(value)) continue
            offenders.push(`${name}:${i + 1}  \${${value}}`)
          }
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('escapes every concatenated HTML sink too', () => {
    // The template scan above only sees <tag ...>${...}</tag>. Plenty of these
    // renderers build markup by *joining* — '<span>' + value + '</span>' — and
    // no `${}` ever appears there, so that shape slips through silently. Two
    // kinds of concatenand, checked separately: a bare value the caller must have
    // escaped, and a call whose return value this file built itself (audit it
    // there, not here). Anything in neither list is a sink nobody has claimed,
    // which is the exact shape of the bug — so it fails the build.
    // t() is deliberately not on the list: a translated string is attacker-
    // influenceable via the catalog, so it must arrive as escapeHtml(t(...)).
    const sources: Array<[string, string]> = [
      ['app.ts', CLIENT_APP_JS],
      ['sdk.ts', CLIENT_SDK_JS],
      ['workspace-files.ts', workspaceFilesFrontend ?? ''],
      ['prompt-templates.ts', promptTemplatesFrontend ?? ''],
      ['metrics-monitor.ts', metricsMonitorFrontend ?? ''],
      ['tools-inspector.ts', toolsInspectorFrontend ?? ''],
    ]

    // Strings that carry an HTML tag somewhere in them, immediately followed by
    // an expression being concatenated on. Requires the quote and the tag to be
    // on the same line, which is how these are actually written.
    const CONCAT = /'[^']*<[a-zA-Z][^']*'\s*\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)(\s*\()?/g

    // Bare values a builder may concatenate unescaped, each with the reason it
    // is already safe.
    const DECLARED: Record<string, string> = {
      // formatMarkdown: already inside escapeHtml(text) before the regex pass,
      // so `code` is inert markup-safe text and `lang` is charset-limited.
      code: 'escaped by formatMarkdown before the code-block pass',
      lang: 'charset-limited by the code-block regex [a-zA-Z0-9_-]*',
      // A class suffix built from a fixed literal in the same expression.
      sel: "ternary of literals: a.id === activeId ? ' active' : ''",
      // A number for an <input value> / a preset chip label. min/max/step come
      // from the SETTINGS schema, cur from Number(row.value).
      cur: 'Number() over a settings value, used in <input value>',
      min: 'settings schema min',
      max: 'settings schema max',
      sizeStr: 'workspace-files: bytes rounded from file.size',
      // Already-joined fragments this file built, every field escaped inside.
      btns: 'segmentedControl: every button escaped, only literal class suffixes',
      chips: 'numberControl: preset chips, literal class suffixes plus numbers',
    }

    // Call-form concatenands: these return a fragment this file built itself, so
    // their internals are the ones to audit rather than the call site. t() is
    // deliberately absent — a translated string reaches a sink through t(), so it
    // has to be escapeHtml(t(...)).
    const DECLARED_CALL: Record<string, string> = {
      controlFor: 'settings row renderer: dispatches to the escaped controls',
      highlight: 'searchHighlight: input escaped before slicing, so its output is safe HTML',
      'diff.map': 'tools-inspector diff rows: every field escaped inside the callback',
      'safe.slice': 'searchHighlight: slices of an already-escaped label',
    }

    const offenders: string[] = []
    const declared = new Set(Object.keys(DECLARED))
    const declaredCall = new Set(Object.keys(DECLARED_CALL))
    for (const [name, source] of sources) {
      source.split('\n').forEach((line, i) => {
        if (!line.includes('<')) return
        for (const m of line.matchAll(CONCAT)) {
          const id = m[1]
          const isCall = Boolean(m[2])
          if (line.includes('escapeHtml(')) continue
          const known = isCall ? declaredCall : declared
          if (!known.has(id)) {
            offenders.push(
              `${name}:${i + 1}  undeclared ${isCall ? 'call' : 'value'} concat of ${id} — ` +
              'escape it at the sink, or declare it with a reason',
            )
          }
        }
      })
    }
    expect(offenders).toEqual([])

    // And the declaration itself is a maintenance list, not dead weight: an entry
    // has to name a variable that really exists somewhere in the sources, and
    // carry a reason, so neither the list nor the sinks it covers can rot.
    const joined = sources.map(([, s]) => s).join('\n')
    for (const [id, why] of Object.entries({ ...DECLARED, ...DECLARED_CALL })) {
      expect(why.length, `${id} needs a reason`).toBeGreaterThan(10)
      expect(new RegExp(`\\b${id.replace('.', '\\.')}\\b`).test(joined), `${id} is declared but used nowhere`).toBe(true)
    }
  })

  it('escapes markdown output before it becomes HTML', () => {
    // formatMarkdown is the one place the *model's own words* become markup, and
    // the copy button it injects carries an inline onclick handler — so this is
    // the sink that matters most. Run the real function (lifted out of the served
    // string) over the payloads that would break a naive implementation.
    const run = new Function(markdownBody + '\nreturn formatMarkdown;')() as (t: string) => string

    // Literal tags cannot survive: the formatter escapes first.
    expect(run('hello <img src=x onerror=alert(1)>')).not.toContain('<img')
    // A breakout attempt from inside a fenced block stays inside it.
    const fenced = run('```html\n</code></pre></div><img src=x onerror=alert(1)>\n```')
    expect(fenced).not.toContain('<img')
    expect(fenced).toContain('&lt;/code&gt;')
    // The language tag cannot be escaped either: its capture group is charset-limited.
    expect(run('```js\nx\n```')).toContain('class="code-lang">js<')
    // $& inside a capture is literal text, not a substitution — the classic
    // string-replacement footgun that would otherwise rewrite the HTML around it.
    expect(run('a `$&` b')).toContain('<code class="inline-code">$&amp;</code>')
    // And the copy button is still emitted, so the escape did not break rendering.
    expect(run('```\nx\n```')).toContain('copy-code-btn')
  })

  it('serves the whole command registry to the palette, in the reader language', async () => {
    const res = await get('/api/commands')
    expect(res.status).toBe(200)
    const data: any = await res.json()
    const rows = data.commands

    // One row per registry command — the palette's list is the TUI's autocompletion
    // list, not a hand-kept subset that goes stale the moment a command is added.
    expect(rows.map((r: any) => r.name).sort()).toEqual(registry.map((c) => c.name).sort())

    // Every row carries the shape the client reads. A missing key renders as
    // `undefined` in the palette rather than failing loudly, so assert the shape.
    const malformed = rows.filter(
      (r: any) =>
        typeof r.name !== 'string' ||
        typeof r.description !== 'string' ||
        !r.description ||
        !Array.isArray(r.aliases) ||
        typeof r.tuiOnly !== 'boolean' ||
        typeof r.requiresArgs !== 'boolean',
    )
    expect(malformed.map((r: any) => r.name)).toEqual([])

    // Descriptions are localized per request from the shared catalog. `t()` inside
    // a command body reads module-level state, so the row has to be re-translated
    // here — a catalog key left in place renders as the key.
    //
    // Re-translating needs the *key* back, which the index recovers by finding the
    // already-rendered sentence in the catalog. So this asserts both directions:
    // no row leaks a key, and a row whose catalog entry has two distinct languages
    // actually changes between ?lang=zh and ?lang=en.
    const seen: Record<string, Record<string, string>> = {}
    for (const lang of ['zh', 'en'] as const) {
      const localized: any = await (await get(`/api/commands?lang=${lang}`)).json()
      expect(localized.lang).toBe(lang)
      seen[lang] = Object.fromEntries(localized.commands.map((r: any) => [r.name, r.description]))
      const untranslated = localized.commands
        .map((r: any) => r.description)
        .filter((d: string) => Object.keys(messages).includes(d))
      expect(untranslated).toEqual([])
    }
    const differing = registry
      .filter((c) => seen.zh[c.name] !== seen.en[c.name])
      .map((c) => c.name)
    expect(differing.length).toBeGreaterThan(20)
    // And every differing row is a real catalog translation, not a coincidence.
    const help = messages['cmd.helpDesc'] as { zh: string; en: string }
    expect(seen.zh.help).toBe(help.zh)
    expect(seen.en.help).toBe(help.en)
  })

  it('marks the commands whose bare form only switches a panel as needing an argument', async () => {
    const data: any = await (await get('/api/commands')).json()
    const byName = new Map<string, any>(data.commands.map((r: any) => [r.name, r]))

    // The probe runs each command against the browser's own CommandContext, so a
    // command whose whole bare body is `openPanel('usage')` has nothing to print
    // and nothing to switch: it needs the argument that names a value.
    for (const name of ['config', 'usage', 'status', 'stats']) {
      expect(byName.get(name).requiresArgs).toBe(true)
    }
    // A bare /help acts, so it must not be pushed behind an argument prompt.
    expect(byName.get('help').requiresArgs).toBe(false)
    expect(byName.get('version').requiresArgs).toBe(false)
  })

  it('runs a slash command and returns what it printed, with no sentinel left in the text', async () => {
    const version = await post('/api/commands/run', { command: '/version' })
    expect(version.status).toBe(200)
    const printed: any = await version.json()
    expect(printed.ok).toBe(true)
    expect(printed.messages.length).toBeGreaterThan(0)
    expect(printed.messages[0].content).toMatch(/MeowCode v/)

    // An unknown command is a rendered error message, not a failed request: the
    // palette shows it in the transcript either way.
    const unknown = await post('/api/commands/run', { command: '/no-such-command' })
    expect(unknown.status).toBe(200)
    const miss: any = await unknown.json()
    expect(miss.messages[0].meta.error).toBe(true)

    // A side-panel switch has no text of its own, so the server used to smuggle it
    // out as a \x00-prefixed sentinel in the printed stream. That reached the
    // transcript as an unprintable glyph inside a document, so it is prose now.
    const usage = await post('/api/commands/run', { command: '/usage' })
    const shown: any = await usage.json()
    const all = shown.messages.map((m: any) => String(m.content)).join('')
    expect(/[\x00-\x08\x0b-\x1f]/.test(all)).toBe(false)
    expect(all).toBe(markerTextFor('usage', 'zh'))

    const empty = await post('/api/commands/run', { command: '   ' })
    expect(empty.status).toBe(400)
  })

  it('lets a browser-run command write the setting file /config reads', async () => {
    const before: any = await (await get('/api/settings')).json()
    const current = before.settings.find((s: any) => s.key === 'verbose').value
    try {
      const res = await post('/api/commands/run', { command: `/config verbose ${!current}` })
      expect(res.status).toBe(200)
      const after: any = await (await get('/api/settings')).json()
      expect(after.settings.find((s: any) => s.key === 'verbose').value).toBe(!current)
    } finally {
      await post('/api/commands/run', { command: `/config verbose ${current}` })
    }
  })

  it('queues a follow-up line for the running turn and refuses empty text', async () => {
    const ok = await post('/api/turn/queue', { text: 'and then summarize the diff' })
    expect(ok.status).toBe(200)
    expect((await ok.json() as any).ok).toBe(true)

    const empty = await post('/api/turn/queue', { text: '   ' })
    expect(empty.status).toBe(400)
  })

  // ── The turn loop is the shared one ────────────────────────────────────
  // The point of wiring the WebUI onto provider.agent() was to stop it running a
  // second, private copy of the agent loop. These watch the wire rather than the
  // code: a turn started here has to stream its events over SSE and commit the same
  // message rows the TUI's transcript gets, because a loop that looked right but
  // produced its own event shapes would be exactly the duplication this removed.
  //
  // Real time, not mocked: the mock provider streams a canned reply token by token
  // over about a second (providers/mock.ts), which is what makes the queued-line
  // test real — a line queued while it streams really does arrive with no tool
  // batch left to drain it. That costs more than the suite's default timeout, so
  // these carry their own.

  /** A live SSE subscription, readable on demand so a test can poll its frames. */
  const openSse = async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/events`, {
      headers: { Authorization: `Bearer ${instance.token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    if (!res.body) throw new Error('the SSE response carried no body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const state = { text: '' }
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) return
          state.text += decoder.decode(value, { stream: true })
        }
      } catch {
        // A cancelled reader rejects — the normal end of a bounded read.
      }
    })()
    return { text: () => state.text, close: () => reader.cancel().catch(() => {}) }
  }

  /** Poll session state until `done` says the turn is finished, or time runs out. */
  const waitForTurn = async (
    before: any,
    done: (state: any) => boolean,
    timeoutMs: number,
  ): Promise<any> => {
    const deadline = Date.now() + timeoutMs
    let state = before
    while (Date.now() < deadline) {
      state = await (await get('/api/session/state')).json()
      if (done(state)) return state
      await new Promise((r) => setTimeout(r, 40))
    }
    return state
  }

  it('streams a real turn over SSE and commits it to the session transcript', async () => {
    // SSE is the turn's output channel, so a regression that ran a turn without
    // streaming would still 200 on /api/turn and look fine from a status line.
    const sse = await openSse()
    const before: any = await (await get('/api/session/state')).json()
    try {
      const res = await post('/api/turn', { prompt: 'hello from the wiring test' })
      expect(res.status).toBe(200)

      const state = await waitForTurn(before, (s) => !s.isRunning && s.messages.length > before.messages.length, 15000)

      // The prompt is a real user row and the reply a real assistant row — the shapes
      // useChat commits, not a WebUI-private transcript.
      const added = state.messages.slice(before.messages.length)
      expect(added.some((m: any) => m.role === 'user' && m.content === 'hello from the wiring test')).toBe(true)
      expect(added.some((m: any) => m.role === 'assistant' && String(m.content).length > 0)).toBe(true)
      expect(state.usage.turns).toBeGreaterThan(before.usage.turns)

      // And the frames really went out over the stream, not just into the transcript.
      expect(sse.text()).toContain('event: turn:start')
      expect(sse.text()).toContain('event: agent:event')
      expect(sse.text()).toContain('event: turn:end')
    } finally {
      await sse.close()
    }
  }, 20000)

  it('does not strand a queued line behind the turn that outlived it', async () => {
    // The agent loop drains takePending only after a *tool batch*, so a line typed
    // while the model streams its final answer is still queued when the turn returns
    // — and the browser has no Esc-flush the way the TUI does, so nothing else would
    // ever run it. The server turns each leftover into its own turn.
    //
    // Queued while the mock is mid-stream, where no tool batch can follow: the only
    // thing that can save this line is the end-of-turn drain.
    const before: any = await (await get('/api/session/state')).json()
    const res = await post('/api/turn', { prompt: 'queue-then-drain probe' })
    expect(res.status).toBe(200)
    expect(((await (await get('/api/session/state')).json()) as any).isRunning).toBe(true)
    await post('/api/turn/queue', { text: 'DRAINED PROBE LINE' })

    // Wait for the line AND for everything it kicked off to finish: the drain runs
    // the leftover as its own turn, so `isRunning` goes true again after it first
    // goes false, and the assertion has to look past that.
    const sawLine = (s: any) => s.messages.some((m: any) => String(m.content).includes('DRAINED PROBE LINE'))
    const state = await waitForTurn(before, (s) => sawLine(s) && !s.isRunning, 25000)

    expect(sawLine(state), 'a queued line must never vanish').toBe(true)
    // It became a *user* row, which is what "the model saw it" means here: the
    // drain commits it like any other prompt, so the next turn's context carries it.
    expect(
      state.messages.some((m: any) => m.role === 'user' && String(m.content).includes('DRAINED PROBE LINE')),
    ).toBe(true)
  }, 30000)

  it('rejects a response to an interaction nobody asked for', async () => {
    const res = await post('/api/interaction/respond', {
      id: 'no-such-interaction',
      response: { decision: 'allow' },
    })
    expect(res.status).toBe(404)
  })

  // ── The parked-permission handshake ────────────────────────────────────
  // This is the part of the security model a static read of the code does not
  // settle: an 'ask' parks a promise, and something has to be able to find it and
  // answer it. Before /api/interaction existed, only a tab already listening on SSE
  // at the moment the question was raised could answer — so a test could not drive
  // it at all (it hung), and a real user who closed or reloaded their tab mid-turn
  // was stuck until the 180s timeout. These drive it the way a second tab does:
  // raise a call that must ask, read the parked id back, answer it.

  /** Park a tool call, wait for its prompt to appear, and hand back both. */
  const raiseAndPark = async (name: string, input: Record<string, unknown>) => {
    const call = post('/api/tools/call', { name, input })
    // The tool call must NOT resolve on its own — that is what "parked" means,
    // and a regression that skipped the gate would resolve it here instead.
    let settled = false
    void call.then(() => { settled = true })

    const deadline = Date.now() + 4000
    let pending: string[] = []
    while (Date.now() < deadline && pending.length === 0) {
      const res = await get('/api/interaction')
      pending = ((await res.json()) as { pending: string[] }).pending
      if (pending.length === 0) await new Promise((r) => setTimeout(r, 40))
    }
    expect(pending.length, 'the call should have parked a prompt').toBeGreaterThan(0)
    expect(settled, 'the tool call must not resolve while the prompt is unanswered').toBe(false)
    return { id: pending[0], call }
  }

  /**
   * Run `body` with `permissionMode` written, then put the settings bag back.
   *
   * The suite seeds `default`, where a read-only tool is *allowed* outright and so
   * never parks anything — which is why these tests have to ask for `plan`, where
   * read_file is exactly the call that requires a prompt. The bag is read back and
   * written whole (see restoreConfig's note) so the restore is complete rather than
   * a merge that can only add keys.
   */
  const withPermissionMode = async <T>(mode: string, body: () => Promise<T>): Promise<T> => {
    const bag = (((await (await get('/api/config')).json()) as any).settings ?? {}) as Record<string, unknown>
    await post('/api/config', { settings: { ...bag, permissionMode: mode } })
    try {
      return await body()
    } finally {
      await post('/api/config', { settings: bag })
    }
  }

  // ── A config write must land the value the schema describes ────────────
  // POST /api/config used to persist whatever JSON it was handed, so a client could
  // put a value on disk that no control in the settings panel can produce —
  // `chatWidth: 720` against an enum of 640/860/1200. `/config <k> <v>` already
  // went through coerceSetting (commands/index.ts's setSchemaSetting); this is the
  // same gate on the HTTP path, so both surfaces write the same set of values.

  it('refuses a settings value the schema does not allow, and writes nothing', async () => {
    const before: any = await (await get('/api/config')).json()
    for (const bad of [
      { chatWidth: 720 },          // not one of 640 / 860 / 1200
      { chatWidth: 'abc' },       // not even a number
      { thinkingMode: 'deep' },   // not one of auto / off / on
      { contextWindow: 'zzz' },   // not a number, for a numeric row
    ]) {
      const res = await post('/api/config', { settings: bad })
      expect(res.status, `${JSON.stringify(bad)} should be refused`).toBe(400)
      expect(String((await res.json() as any).error)).toContain(':')
    }
    // The whole point: a refused write leaves the file exactly as it was. Asserted
    // as a whole bag, because the write is a merge — one key sneaking through is
    // exactly the failure mode this guards.
    const after: any = await (await get('/api/config')).json()
    expect(after.settings).toEqual(before.settings)
  })

  it('canonicalizes an accepted settings value through the same coercion /config uses', async () => {
    const read = async (key: string) => ((await (await get('/api/config')).json()) as any).settings[key]
    const before = { chatWidth: await read('chatWidth'), thinkingMode: await read('thinkingMode') }
    try {
      // chatWidth is an *enum of strings*, so a client sending the JSON number 1200
      // must not store the number 1200 — it stores the canonical entry, which is
      // also what the settings row compares against `default` to draw its dirty dot.
      await post('/api/config', { settings: { chatWidth: 1200 } })
      expect(await read('chatWidth')).toBe('1200')

      // Case is normalized the way `/config thinkingMode ON` would.
      await post('/api/config', { settings: { thinkingMode: 'ON' } })
      expect(await read('thinkingMode')).toBe('on')
    } finally {
      await post('/api/config', { settings: before })
      expect(await read('chatWidth')).toBe(before.chatWidth)
      expect(await read('thinkingMode')).toBe(before.thinkingMode)
    }
  })

  it('still lets a key the schema does not describe through', async () => {
    // The settings bag is deliberately loose — it is typed
    // `Record<string, SettingValue>` rather than the schema, and carries values an
    // extension or an older build wrote. Validating against the schema must not
    // quietly become a whitelist: a key the table does not describe is passed
    // through untouched. (A key the table *does* describe is validated, including
    // the web-only rows — which is the point: those are exactly the ones a browser
    // writes.)
    const probe = '__webui_settings_probe__'
    try {
      const res = await post('/api/config', { settings: { [probe]: 'kept' } })
      expect(res.status).toBe(200)
      expect(((await (await get('/api/config')).json()) as any).settings[probe]).toBe('kept')
    } finally {
      // A merge cannot remove a key, so the probe stays on disk afterwards. That is
      // a property of updateConfig, not of this route — and it is exactly why the
      // suite redirects HOME (see the hoisted mock at the top of this file): a
      // leftover key here costs nothing in a tmpdir, where it would cost a real
      // settings.json.
    }
  })

  it('refuses an AppConfig field that is not a setting, and writes nothing', async () => {
    // The route used to hand its whole parsed body to updateConfig, so any field it
    // carried became session policy — and /api/tools/call runs bash. One POST could
    // turn on bypassPermissions, plant a deny rule, or repoint the provider. Only
    // the four fields the client legitimately writes are accepted now; the rest are
    // refused outright rather than silently dropped, because a silent drop reads to
    // a client as "saved" when it was not.
    const before: any = await (await get('/api/config')).json()
    for (const refused of [
      { apiKey: 'sk-ant-planted' },
      { permissions: { deny: ['bash'] } },
      { permissions: { allow: ['bash'] } },
      { settings: { permissionMode: 'bypassPermissions' } },  // legal as a *setting*…
    ]) {
      const res = await post('/api/config', refused)
      // …and legal, so this one is accepted; it is listed here only to note that the
      // gate is on the *field*, not on the value. Undo it before the next case.
      if (refused.settings) {
        expect(res.status).toBe(200)
        await post('/api/config', { settings: { permissionMode: before.settings.permissionMode } })
        continue
      }
      expect(res.status, `${JSON.stringify(refused)} should be refused`).toBe(400)
      expect(String((await res.json() as any).error)).toContain('not writable')
    }

    // Nothing leaked: no key planted, no rule added, and the mode is where it was.
    const after: any = await (await get('/api/config')).json()
    expect(after.apiKey).toBeUndefined()
    expect(after.settings.permissionMode).toBe(before.settings.permissionMode)
    expect(after.permissions?.deny ?? []).toEqual(before.permissions?.deny ?? [])
    expect(after.permissions?.allow ?? []).toEqual(before.permissions?.allow ?? [])
  })

  it('still writes the four fields the browser legitimately owns', async () => {
    // The counterpart to the refusal above: a gate that accepts nothing would pass
    // the security test while breaking the model picker and the theme control, which
    // post exactly these.
    const before: any = await (await get('/api/config')).json()
    const otherModel = before.model === 'claude-sonnet-4-5' ? 'claude-opus-4-8' : 'claude-sonnet-4-5'
    try {
      const res = await post('/api/config', { model: otherModel, theme: 'nord' })
      expect(res.status).toBe(200)
      const after: any = await (await get('/api/config')).json()
      expect(after.model).toBe(otherModel)
      expect(after.theme).toBe('nord')
    } finally {
      await restoreConfig(before)
    }
  })

  it('runs a queued slash command as a command, not as model-visible prose', async () => {
    // /api/turn/queue is the type-ahead path: prose lands mid-turn. A `/…` line is
    // not prose — fed to the model as text it would be read as an instruction whose
    // words happen to start with a slash, with no hook run and no user line behind
    // it. The TUI routes those to the idle flush instead (app.tsx takePending), and
    // so does this route.
    const res = await post('/api/turn/queue', { text: '/version' })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.ranAsCommand).toBe(true)
    expect(body.messages[0].content).toMatch(/MeowCode v/)

    // Prose still queues quietly, which is the original behaviour.
    const prose = await post('/api/turn/queue', { text: 'and then summarize the diff' })
    expect(prose.status).toBe(200)
    expect((await prose.json() as any).ranAsCommand).toBeUndefined()
  })

  it('parks a permission prompt where another client can find it, and settles it', async () => {
    await withPermissionMode('plan', async () => {
      const { id, call } = await raiseAndPark('read_file', { path: 'package.json' })
      expect(id).toMatch(/^perm-/)

      // Still parked a moment later — a prompt nobody answered must not time out in
      // milliseconds, and must not auto-resolve to "allow" instead.
      expect(((await (await get('/api/interaction')).json()) as any).pending).toContain(id)

      const answered = await post('/api/interaction/respond', {
        id,
        response: { decision: 'deny' },
        clientId: 'test-client',
      })
      expect(answered.status).toBe(200)

      // The refusal is the tool's answer, not a transport error: the caller sees
      // the same shape the TUI's denied tool_result has.
      const result: any = await (await call).json()
      expect(result.isError).toBe(true)
      expect(result.content).toContain('拒绝')

      // And the prompt is no longer pending — it must not be answerable again, nor
      // listed to a client that reconnects and would render a dialog for it.
      expect(((await (await get('/api/interaction')).json()) as any).pending).not.toContain(id)
    })
  })

  it('lets an allowed prompt run the tool for real', async () => {
    await withPermissionMode('plan', async () => {
      const { id, call } = await raiseAndPark('read_file', { path: 'package.json' })
      const answered = await post('/api/interaction/respond', {
        id,
        response: { decision: 'allow' },
        clientId: 'test-client',
      })
      expect(answered.status).toBe(200)
      const result: any = await (await call).json()
      expect(result.isError).toBeFalsy()
      expect(String(result.content)).toContain('meowcode')
    })
  })

  it('settles a prompt once: a different client, or the same client with a different answer, is refused', async () => {
    await withPermissionMode('plan', async () => {
      const { id, call } = await raiseAndPark('read_file', { path: 'package.json' })

      const first = await post('/api/interaction/respond', {
        id,
        response: { decision: 'deny' },
        clientId: 'tab-A',
      })
      expect(first.status).toBe(200)

      // Another tab answering the same question must not also get a 200 — it would
      // believe it allowed the tool while the deny had already settled it.
      const otherTab = await post('/api/interaction/respond', {
        id,
        response: { decision: 'allow' },
        clientId: 'tab-B',
      })
      expect(otherTab.status).toBe(409)

      // The same client repeating the *same* answer is a retry after a dropped
      // response, not a second decision: it gets an idempotent 200.
      const retry = await post('/api/interaction/respond', {
        id,
        response: { decision: 'deny' },
        clientId: 'tab-A',
      })
      expect(retry.status).toBe(200)
      expect(((await retry.json()) as any).alreadyAnswered).toBe(true)

      // But the same client changing its mind is a second decision, and is refused.
      const changed = await post('/api/interaction/respond', {
        id,
        response: { decision: 'allow' },
        clientId: 'tab-A',
      })
      expect(changed.status).toBe(409)

      // Whatever the retries said, the first answer is the one the tool saw.
      const result: any = await (await call).json()
      expect(result.isError).toBe(true)
      expect(result.content).toContain('拒绝')
    })
  })

  it('fails closed on an answer that names no decision', async () => {
    await withPermissionMode('plan', async () => {
      const { id, call } = await raiseAndPark('read_file', { path: 'package.json' })
      // A malformed body must not read as "allowed": promptPermission only returns
      // 'allow' for a literal decision of allow, and anything else denies.
      const answered = await post('/api/interaction/respond', { id, clientId: 'test-client' })
      expect(answered.status).toBe(200)
      const result: any = await (await call).json()
      expect(result.isError).toBe(true)
      expect(result.content).toContain('拒绝')
    })
  })

  it('refuses a mutating tool outright in plan mode, without prompting', async () => {
    // The gate has two exits and this is the other one: `deny` never reaches the
    // broker, so nothing is parked and the caller is told why immediately. Same
    // mode question as above, answered the same way.
    await withPermissionMode('plan', async () => {
      const res = await post('/api/tools/call', { name: 'bash', input: { command: 'echo nope' } })
      expect(res.status).toBe(403)
      const body: any = await res.json()
      expect(body.isError).toBe(true)
      expect(((await (await get('/api/interaction')).json()) as any).pending).toEqual([])
    })
  })

  // ── Security ───────────────────────────────────────────────────────────
  // The WebUI runs bash on the user's machine, so "any web page can POST to this
  // port" is not an acceptable default. These assert the two layers that close
  // it: the token on /api/*, and the origin allowlist on everything.

  it('serves the document without a credential, and refuses /api without one', async () => {
    // Public by design: the page has to render before it can carry the token.
    // Everything under /api/ is not. (src/webui/auth.test.ts covers the token's
    // accepted forms and the anti-DNS-rebinding Host check; these assert the
    // origin layer, which is the half that stays on even when auth is off.)
    const doc = await fetch(`http://127.0.0.1:${testPort}/`)
    expect(doc.status).toBe(200)

    const guarded = await fetch(`http://127.0.0.1:${testPort}/api/session/state`)
    expect(guarded.status).toBe(401)
  })

  it('refuses /api/* with no token and with the wrong one', async () => {
    const missing = await fetch(`http://127.0.0.1:${testPort}/api/session/state`)
    expect(missing.status).toBe(401)

    const wrong = await fetch(`http://127.0.0.1:${testPort}/api/session/state`, {
      headers: { Authorization: 'Bearer not-the-real-token' },
    })
    expect(wrong.status).toBe(401)
  })

  it('accepts the token as a Bearer header', async () => {
    const viaHeader = await get('/api/session/state')
    expect(viaHeader.status).toBe(200)
  })

  it('never echoes a foreign origin, and answers its preflight with 403', async () => {
    const foreign = 'https://evil.example.com'
    const res = await fetch(`http://127.0.0.1:${testPort}/api/session/state`, {
      headers: { Authorization: `Bearer ${instance.token}`, Origin: foreign },
    })
    expect(res.status).toBe(403)
    // No ACAO header at all is what makes the browser refuse the response.
    expect(res.headers.get('access-control-allow-origin')).toBeNull()

    const preflight = await fetch(`http://127.0.0.1:${testPort}/api/session/state`, {
      method: 'OPTIONS',
      headers: { Origin: foreign, 'Access-Control-Request-Method': 'GET' },
    })
    expect(preflight.status).toBe(403)
  })

  it('echoes the same origin back', async () => {
    const same = `http://127.0.0.1:${testPort}`
    const res = await fetch(`http://127.0.0.1:${testPort}/api/session/state`, {
      headers: { Authorization: `Bearer ${instance.token}`, Origin: same },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(same)
  })

  it('does not let a deny rule be sidestepped through the HTTP tool route', async () => {
    // /api/tools/call bypasses the model, so it re-applies the layering itself.
    // A deny rule must win there exactly as it does inside the agent loop.
    // The rule is planted the way the palette plants it — /permissions, which is the
    // surface that owns rule lists — because /api/config refuses them (see the
    // refuse-the-body test below).
    await post('/api/commands/run', { command: '/permissions deny bash' })
    const rules = ((await (await get('/api/config')).json()) as any).permissions
    expect(rules?.deny).toContain('bash')
    try {
      const res = await post('/api/tools/call', { name: 'bash', input: { command: 'echo hi' } })
      expect(res.status).toBe(403)
      expect((await res.json() as any).isError).toBe(true)

      // The gate discriminates rather than blanket-denying: a read-only tool is
      // auto-allowed under the default mode, so it still runs.
      const read = await post('/api/tools/call', {
        name: 'read_file',
        input: { path: 'package.json' },
      })
      expect(read.status).toBe(200)
      expect((await read.json() as any).isError).toBeFalsy()
    } finally {
      // Removed through the command that added it: a merge cannot remove a key, so
      // `{permissions: undefined}` would leave the rule behind for the rest of the
      // suite (and, without the HOME redirect at the top of this file, for the day).
      await post('/api/commands/run', { command: '/permissions remove bash' })
      expect(((await (await get('/api/config')).json()) as any).permissions?.deny ?? []).toEqual(
        (rules?.deny ?? []).filter((r: string) => r !== 'bash'),
      )
    }
  })

  it('runs --no-auth servers open, but still refuses a foreign origin', async () => {
    // `auth: false` is the explicit "I mean to expose this" switch. What it must
    // NOT do is turn off the origin layer: a page on evil.example still cannot
    // read the API, so exposing the port does not also expose it to the web.
    const openPort = testPort + 1
    const open = createWebUIServer({ port: openPort, host: '127.0.0.1', openBrowser: false, auth: false })
    await new Promise<void>((resolve) => {
      ;(open as any).listen(openPort, () => resolve())
    })
    try {
      // No credential needed — that is what the flag means.
      const res = await fetch(`http://127.0.0.1:${openPort}/api/session/state`)
      expect(res.status).toBe(200)

      const foreign = await fetch(`http://127.0.0.1:${openPort}/api/session/state`, {
        headers: { Origin: 'https://evil.example.com' },
      })
      expect(foreign.status).toBe(403)
    } finally {
      await open.close()
    }
  })
})

