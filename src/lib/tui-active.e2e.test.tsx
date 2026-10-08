import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

// Redirect the config dir BEFORE anything imports it: useChat persists settings,
// sessions and stats through ~/.meowcode, and this must not touch the real one.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meow-tui-home-'))
process.env.HOME = TMP_HOME
process.env.USERPROFILE = TMP_HOME

const React = await import('react')
const { Text } = await import('ink')
const { renderToFrames } = await import('./ink-harness')
const { useChat } = await import('../hooks/useChat')
const { flattenMessages } = await import('./transcript')
const { setLang } = await import('./i18n')
const { mockProvider } = await import('../providers/mock')
const { loadConfig } = await import('../config')

/** The structural view of Chat the probe reads. Not `Chat` itself: the real
 *  `submit` takes a ChatActions, and the test passes a stub, so the signatures
 *  would never unify. */
interface ChatLike {
  submit: (s: string, actions: unknown) => Promise<void>
  activeTools: Set<string>
  turnActive: boolean
  messages: never[]
}

/**
 * A box, not a `let chat = null`: TypeScript pins a `let x = null` to `null` for
 * the whole function, so every later read is `never` and the call site does not
 * compile even though a render obviously assigns it.
 */
const box: { current: ChatLike | null } = { current: null }

const NOOP_ACTIONS = { exit: () => {}, clear: () => {}, requestPermission: async () => 'allow' as const }

/**
 * The active fold block, driven through the REAL turn loop.
 *
 * transcript-active.test.ts flattens a hand-built message list, which cannot
 * catch a break anywhere upstream — the provider not yielding `title`, useChat
 * not tracking the id, the state not reaching flattenMessages. This runs the
 * actual agent loop and reads what the TUI would show mid-turn, which is the
 * shape the bug report is about (「这一块是活动折叠块，还是原来的形式」).
 */
describe('active fold block, end to end through the real turn loop', () => {
  beforeAll(() => setLang('zh'))

  afterAll(() => {
    try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch {}
  })

  it('shows the running heading mid-flight, and the past-tense summary once the result lands', async () => {
    const realAgent = mockProvider.agent
    // A box, not `let release: (() => void) | null`: the assignment happens
    // inside the Promise executor, which TypeScript's control flow does not
    // track, so it keeps narrowing the variable to null and `release?.()`
    // becomes a call on never.
    const release: { fire: () => void } = { fire: () => {} }
    const gate = new Promise<void>((r) => { release.fire = r })

    // One call announced, its result held back — the exact mid-turn shape.
    ;(mockProvider as any).agent = async function* () {
      yield { type: 'tool_use', id: 'call-slow', name: 'bash', input: { command: 'ls' } }
      await gate
      yield { type: 'tool_result', id: 'call-slow', name: 'bash', content: 'ok' }
    }

    function Probe(): React.ReactElement {
      const c = useChat({ ...loadConfig(), provider: 'mock' })
      box.current = c as unknown as ChatLike
      return React.createElement(
        'div',
        null,
        ...flattenMessages(c.messages, 100, { activeTools: c.activeTools, turnActive: c.turnActive }).map((l: { text: string }, i: number) =>
          React.createElement(Text, { key: i }, l.text || ' '),
        ),
      )
    }

    renderToFrames(React.createElement(Probe), { cols: 100, rows: 30 })
    // Let the hook commit once, so box.current is the current render's object.
    await new Promise((r) => setTimeout(r, 250))
    // Read through the box, never a captured snapshot: every render builds a
    // fresh object, so a snapshot taken before the turn reports pre-turn state.
    const now = (): ChatLike => box.current as ChatLike
    const rows = (): string =>
      flattenMessages(now().messages, 100, { activeTools: now().activeTools, turnActive: now().turnActive })
        .map((l: { text: string }) => l.text).join('\n')

    try {
      // Not awaited: submit resolves only once the whole turn ends, and the
      // point of the probe is the state in between.
      const turn = now().submit('run: ls', NOOP_ACTIONS)
      turn.catch(() => {})

      // Wait for the announce to land rather than guessing a delay.
      const deadline = Date.now() + 5000
      while (now().activeTools.size === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20))
      }
      const midActive = now().activeTools.size
      const mid = rows()

      release.fire()
      await turn
      const after = rows()

      expect(midActive).toBe(1)
      // Two rows: the present-tense heading, then the argument it acts on.
      expect(mid).toContain('正在运行')
      expect(mid).toContain('⎿  ls')
      expect(after).not.toContain('正在运行')
      expect(after).toContain('运行 ls')
      expect(now().activeTools.size).toBe(0)
    } finally {
      ;(mockProvider as any).agent = realAgent
    }
  }, 30000)

  it('keeps saying "now" in the gap BETWEEN two calls of the same turn', async () => {
    // The reported shape: a run of several tools plus thinking, where the fold
    // block spent most of the turn reading as history. Between two sequential
    // calls the previous result HAS landed and the next has not been announced
    // yet — `activeTools` is legitimately empty there, so the heading must come
    // from the turn still being in flight, not from an open call.
    const realAgent = mockProvider.agent
    const gate = { hold: false }
    // A box, not `let release = …`: the assignment happens inside the Promise
    // executor, which TypeScript's control flow does not track, so it keeps
    // narrowing the variable to null and `release?.()` becomes a call on never.
    const release: { fire: () => void } = { fire: () => {} }
    const gap = new Promise<void>((r) => { release.fire = r })

    ;(mockProvider as any).agent = async function* () {
      // First call: completes.
      yield { type: 'tool_use', id: 'call-1', name: 'bash', input: { command: 'git status' } }
      await new Promise((r) => setTimeout(r, 30))
      yield { type: 'tool_result', id: 'call-1', name: 'bash', content: 'ok' }
      // Then the model starts its next move: thinking, then a second call that
      // parks. `gap` is observed while only the THINKING is live.
      yield { type: 'thinking', text: 'deciding what to read next' }
      if (gate.hold) await gap
      yield { type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'src/lib/tool-title.ts' } }
      await new Promise(() => {})
    }

    function Probe(): React.ReactElement {
      const c = useChat({ ...loadConfig(), provider: 'mock' })
      box.current = c as unknown as ChatLike
      return React.createElement(
        'div',
        null,
        ...flattenMessages(c.messages, 100, { activeTools: c.activeTools, turnActive: c.turnActive }).map((l: { text: string }, i: number) =>
          React.createElement(Text, { key: i }, l.text || ' '),
        ),
      )
    }

    renderToFrames(React.createElement(Probe), { cols: 100, rows: 30 })
    await new Promise((r) => setTimeout(r, 250))
    const now = (): ChatLike => box.current as ChatLike

    try {
      gate.hold = true
      now().submit('run: ls', NOOP_ACTIONS).catch(() => {})
      // The first call's header AND its ⎿ result are both committed (banner +
      // prompt + 2 = 4 messages), and no call is announced: that is the gap.
      // Waiting on "the set happens to be empty" would race — the next announce
      // can land in the same tick — so the RESULT is the condition, and the
      // header is matched by its glyph, not by the call id (which lives in meta).
      const committed = (m: { content: string }): boolean => m.content.startsWith('●') || m.content.startsWith('⎿')
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const msgs = now().messages as unknown as { content: string }[]
        if (now().activeTools.size === 0 && msgs.filter(committed).length >= 2) break
        await new Promise((r) => setTimeout(r, 10))
      }
      const gapRows = flattenMessages(now().messages, 100, { activeTools: now().activeTools, turnActive: now().turnActive })
        .map((l: { text: string }) => l.text).join('\n')
      // Captured HERE, not asserted later: the state moves on as soon as the
      // second call is announced, and reading the live object after that would
      // be checking the wrong moment.
      const gapActive = now().activeTools.size
      const gapTurnActive = now().turnActive

      release.fire()
      await new Promise((r) => setTimeout(r, 250))
      const secondCall = flattenMessages(now().messages, 100, { activeTools: now().activeTools, turnActive: now().turnActive })
        .map((l: { text: string }) => l.text).join('\n')
      const secondActive = now().activeTools

      // In the gap: past-tense summary, marked unfinished, with NO heading —
      // there is no call for the model to have titled.
      expect(gapActive).toBe(0)
      expect(gapTurnActive).toBe(true)
      expect(gapRows).toContain('运行 git')
      expect(gapRows).toContain('进行中')
      expect(gapRows).not.toContain('正在')

      // Once the next call is announced the heading takes over.
      expect(secondActive.has('call-2')).toBe(true)
      expect(secondCall).toContain('正在读取')
      expect(secondCall).toContain('⎿  src/lib/tool-title.ts')
    } finally {
      ;(mockProvider as any).agent = realAgent
    }
  }, 30000)

  it('leaves a call with no result reading as history, not as work in flight', async () => {
    // A restored session and an interrupted call both land here. Reporting
    // either as "still running" is a lie the user acts on.
    const realAgent = mockProvider.agent
    ;(mockProvider as any).agent = async function* () {
      yield { type: 'tool_use', id: 'call-gone', name: 'bash', input: { command: 'ls' } }
      // End the turn with the result never delivered.
    }

    function Probe(): React.ReactElement {
      const c = useChat({ ...loadConfig(), provider: 'mock' })
      box.current = c as unknown as ChatLike
      return React.createElement(
        'div',
        null,
        ...flattenMessages(c.messages, 100, { activeTools: c.activeTools, turnActive: c.turnActive }).map((l: { text: string }, i: number) =>
          React.createElement(Text, { key: i }, l.text || ' '),
        ),
      )
    }

    renderToFrames(React.createElement(Probe), { cols: 100, rows: 30 })
    await new Promise((r) => setTimeout(r, 250))
    const now = (): ChatLike => box.current as ChatLike

    try {
      await now().submit('run: ls', NOOP_ACTIONS)
      const after = flattenMessages(now().messages, 100, { activeTools: now().activeTools, turnActive: now().turnActive })
        .map((l: { text: string }) => l.text).join('\n')

      expect(after).toContain('运行 ls')
      expect(after).not.toContain('正在运行')
      expect(now().activeTools.size).toBe(0)
    } finally {
      ;(mockProvider as any).agent = realAgent
    }
  }, 30000)
})