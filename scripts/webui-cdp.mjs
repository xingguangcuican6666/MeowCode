// Minimal Chrome DevTools Protocol driver (Node >=22 global WebSocket).
// Usage: node scripts/webui-cdp.mjs <url> [outPng] [--width N] [--height N] [--wait ms] [--script path.js]
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const url = args[0]
const outPng = args[1] && !args[1].startsWith('--') ? args[1] : '/tmp/webui-shot.png'
function flag(name, dflt) {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const width = Number(flag('width', 1440))
const height = Number(flag('height', 900))
const waitMs = Number(flag('wait', 2500))
const scriptPath = flag('script', '')

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-profile-'))
const edgeBin = '/opt/microsoft/msedge/msedge'
const child = spawn(
  edgeBin,
  [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let edgeErr = ''
child.stderr.on('data', (d) => { edgeErr += d.toString() })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/version')
      const j = await r.json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(300)
  }
  throw new Error('edge did not expose CDP: ' + edgeErr.slice(0, 400))
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        this.logs.push({
          level: msg.params.type,
          text: (msg.params.args || [])
            .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
            .join(' '),
        })
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        this.logs.push({ level: 'exception', text: (d.exception && (d.exception.description || d.exception.value)) || d.text })
      } else if (msg.method === 'Log.entryAdded') {
        this.logs.push({ level: 'log:' + msg.params.entry.level, text: msg.params.entry.text })
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, sessionId }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('CDP timeout: ' + method))
        }
      }, 30000)
    })
  }
}

const wsUrl = await findWsUrl()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const cdp = new Cdp(ws)

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => cdp.send(m, p, sessionId)

await S('Page.enable')
await S('Runtime.enable')
await S('Log.enable')
await S('Network.enable')
await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

const failedRequests = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Network.loadingFailed') failedRequests.push(msg.params.errorText + ' ' + (msg.params.type || ''))
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    failedRequests.push(msg.params.response.status + ' ' + msg.params.response.url)
  }
})

await S('Page.navigate', { url })
await sleep(waitMs)

let scriptResult = null
if (scriptPath) {
  const src = fs.readFileSync(scriptPath, 'utf8')
  const r = await S('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true })
  scriptResult = r.exceptionDetails ? { error: r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}) } : r.result.value
}

const shot = await S('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'))

const title = await S('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
const out = {
  title: title.result.value,
  url,
  console: cdp.logs,
  failedRequests,
  scriptResult,
  screenshot: outPng,
}
console.log(JSON.stringify(out, null, 2))

try { child.kill('SIGKILL') } catch {}
fs.rmSync(userDataDir, { recursive: true, force: true })
process.exit(0)