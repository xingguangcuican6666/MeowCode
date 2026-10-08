import { describe, it, expect, beforeAll } from 'vitest'
import { flattenMessages, openToolCalls } from './transcript'
import { setLang } from './i18n'
import { displayWidth } from './text'
import type { AgentEvent, Message } from '../types'

// A call that is REALLY running reads in the present tense, with the model's own
// title when it sent one. "Running" is not something the renderer may infer: a
// header whose result never arrived is far more often an interrupted call or a
// restored session, and calling that "still going" would be a lie the user acts on
// — they would wait for work that is not happening.
describe('active fold block', () => {
  const m = (id: string, role: Message['role'], content: string, meta?: Message['meta']): Message =>
    ({ id, role, content, meta })

  const call = (id: string, path: string, title?: string): Message[] => [
    m(id, 'tool', `● read_file · ${path}`, {
      toolName: 'read_file',
      toolInput: { path },
      toolCallId: `call-${id}`,
      ...(title ? { toolTitle: title } : {}),
    }),
  ]

  const texts = (lines: ReturnType<typeof flattenMessages>): string[] => lines.map((l) => l.text)
  const has = (lines: ReturnType<typeof flattenMessages>, s: string): boolean =>
    lines.some((l) => l.text.includes(s))

  beforeAll(() => setLang('en'))

  it('shows the model title over the argument while the call is in flight', () => {
    const lines = flattenMessages(call('a', 'src/webui/client/sdk.ts', 'Reading the WebUI SDK'), 80, {
      activeTools: new Set(['call-a']),
    })
    expect(texts(lines)[0]).toBe('  ● Reading the WebUI SDK')
    expect(texts(lines)[1]).toBe('  ⎿  src/webui/client/sdk.ts')
  })

  it('falls back to our own verb when the model sent no title', () => {
    const lines = flattenMessages(call('a', 'src/app.tsx'), 80, { activeTools: new Set(['call-a']) })
    expect(has(lines, 'Reading')).toBe(true)
    expect(has(lines, 'src/app.tsx')).toBe(true)
  })

  it('reverts to the past-tense summary once the result lands', () => {
    const done = [...call('a', 'src/app.tsx', 'Reading app.tsx'), m('b', 'tool', '⎿ 1: export const x = 1')]
    // The id is gone from the active set, so the block reads as history.
    const lines = flattenMessages(done, 80, { activeTools: new Set() })
    expect(has(lines, 'Read app.tsx')).toBe(true)
    expect(has(lines, 'Reading app.tsx')).toBe(false)
  })

  it('does NOT claim to be running just because a result is missing', () => {
    // An interrupted call and a restored session both land here.
    const lines = flattenMessages(call('a', 'src/app.tsx'), 80)
    expect(has(lines, 'Read app.tsx')).toBe(true)
    expect(has(lines, '  ⎿  ')).toBe(false)
  })

  it('tracks the call id, not the message id', () => {
    // The header message and the tool_use carry two different ids; matching the
    // wrong one makes every real call look finished.
    const lines = flattenMessages(call('a', 'src/app.tsx', 'Reading app.tsx'), 80, {
      activeTools: new Set(['a']), // the MESSAGE id, not toolCallId
    })
    expect(has(lines, 'Reading app.tsx')).toBe(false)
  })

  it('names the last in-flight call when a run has several', () => {
    const run = [
      ...call('a', 'src/a.ts', 'Reading a.ts'),
      m('b', 'tool', '⎿ 1: a'),
      ...call('c', 'src/b.ts', 'Reading b.ts'),
    ]
    const lines = flattenMessages(run, 80, { activeTools: new Set(['call-c']) })
    expect(has(lines, 'Reading b.ts')).toBe(true)
  })

  it('emits one heading row when the call has no argument to echo', () => {
    const lines = flattenMessages(call('a', ''), 80, { activeTools: new Set(['call-a']) })
    expect(has(lines, 'Reading')).toBe(true)
    expect(has(lines, '⎿')).toBe(false)
  })

  it('survives a title full of separators, control characters and long CJK', () => {
    const hostile = ['A · B', `\u001b[31mC\u001b[0m`, '长'.repeat(120)].join(String.fromCharCode(10))
    const lines = flattenMessages(
      [m('a', 'tool', '● read_file · src/app.tsx', {
        toolName: 'read_file',
        toolCallId: 'call-a',
        toolTitle: hostile,
      })],
      80,
      { activeTools: new Set(['call-a']) },
    )
    // One heading row, no embedded newline: the viewport maps lines[i] to row i.
    expect(lines[0].text).not.toContain('\n')
    expect(lines[1].text).toBe('  ⎿  src/app.tsx')
    // A title containing the separator must not break grouping or parse as a new header.
    expect(lines[0].group).toBe('a')
  })

  it('truncates a heading that is wider than the terminal', () => {
    const lines = flattenMessages(call('a', 'src/a.ts', 'R'.repeat(200)), 40, {
      activeTools: new Set(['call-a']),
    })
    for (const l of lines) expect(displayWidth(l.text)).toBeLessThanOrEqual(40)
  })

  it('never merges a write/edit into the active block — it keeps its diff', () => {
    const write = [
      m('w', 'tool', '● write_file · src/a.ts'),
      m('x', 'tool', '⎿ Added 2 lines, removed 1 line', {
        diff: [{ tag: 'add', newNo: 2, text: 'new' }],
      }),
    ]
    const lines = flattenMessages(write, 80, { activeTools: new Set(['w']) })
    expect(has(lines, 'Write(src/a.ts)')).toBe(true)
    expect(has(lines, '+ new')).toBe(true)
    expect(has(lines, '  ⎿  src/a.ts')).toBe(false)
  })

  it('holds the same heading whether the block is folded or open', () => {
    // The row count must not depend on the fold state — app.tsx's windowing math
    // assumes a stable mapping — and an expanded block still has to say what is
    // running rather than showing the past-tense header.
    const folded = flattenMessages(call('a', 'src/app.tsx', 'Reading app.tsx'), 80, {
      activeTools: new Set(['call-a']),
    })
    const open = flattenMessages(call('a', 'src/app.tsx', 'Reading app.tsx'), 80, {
      activeTools: new Set(['call-a']),
      expanded: new Set(['a']),
    })
    expect(open[0].text).toBe(folded[0].text)
    expect(open[1].text).toBe(folded[1].text)
    expect(open[0].group).toBe('a')
  })

  it('keeps the group id stable as tools join a run and the call finishes', () => {
    // Clicking must toggle the same fold before and after the call completes, or
    // the block collapses itself under the user's cursor.
    const before = flattenMessages(call('a', 'src/a.ts'), 80, { activeTools: new Set(['call-a']) })
    const after = flattenMessages([...call('a', 'src/a.ts'), m('b', 'tool', '⎿ 1: a')], 80)
    expect(before[0].group).toBe('a')
    expect(after[0].group).toBe('a')
  })

  it('shows the running heading under verbose too', () => {
    // `verbose` opens everything; the heading must survive that, not be replaced
    // by a per-call "● read_file · path" header.
    const lines = flattenMessages(call('a', 'src/app.tsx', 'Reading app.tsx'), 80, {
      activeTools: new Set(['call-a']),
      expandAll: true,
    })
    expect(has(lines, 'Reading app.tsx')).toBe(true)
    expect(has(lines, 'src/app.tsx')).toBe(true)
  })

  // The gap between two sequential calls is most of a turn's wall clock: the
  // model is thinking about its next move, no call is open, and the block still
  // has to read as unfinished. Without this the user watches it flip between
  // "Reading X" and a past-tense summary for work that is plainly ongoing.
  it('marks the run unfinished in the gap between two calls of one turn', () => {
    const run = [...call('a', 'src/a.ts', 'Reading a.ts'), m('b', 'tool', '⎿ 1: a')]
    const lines = flattenMessages(run, 80, {
      activeTools: new Set(),   // nothing in flight right now
      turnActive: true,         // but the turn has not ended
    })
    expect(has(lines, 'Read a.ts')).toBe(true)
    expect(has(lines, 'in progress')).toBe(true)
    // No heading: there is no call to name, so no model title is invented.
    expect(has(lines, 'Reading a.ts')).toBe(false)
  })

  it('keeps the in-progress marker off a finished turn', () => {
    const run = [...call('a', 'src/a.ts', 'Reading a.ts'), m('b', 'tool', '⎿ 1: a')]
    const lines = flattenMessages(run, 80, { activeTools: new Set(), turnActive: false })
    expect(has(lines, 'Read a.ts')).toBe(true)
    expect(has(lines, 'in progress')).toBe(false)
    expect(has(lines, '⎿')).toBe(false)
  })

  it('prefers the real heading over the marker when a call IS open', () => {
    const lines = flattenMessages(call('a', 'src/a.ts', 'Reading a.ts'), 80, {
      activeTools: new Set(['call-a']),
      turnActive: true,
    })
    expect(texts(lines)[0]).toBe('  ● Reading a.ts')
    expect(has(lines, 'in progress')).toBe(false)
  })
})

describe('openToolCalls', () => {
  const ev = (o: Partial<AgentEvent>): AgentEvent => o as AgentEvent

  it('reports the unmatched calls of a still-running agent', () => {
    const events = [
      ev({ type: 'tool_use', id: 'c1', name: 'read_file', input: {} }),
      ev({ type: 'tool_result', id: 'c1', name: 'read_file', content: 'x' }),
      ev({ type: 'tool_use', id: 'c2', name: 'read_file', input: {} }),
    ]
    expect([...openToolCalls(events, true)]).toEqual(['c2'])
  })

  it('reports nothing once the agent has reached a terminal state', () => {
    // An agent that errored mid-call did not leave work running.
    const events = [ev({ type: 'tool_use', id: 'c1', name: 'read_file', input: {} })]
    expect(openToolCalls(events, false).size).toBe(0)
  })

  it('tolerates several tool_use events before any result', () => {
    // The mock workflow provider announces a batch of calls and returns the
    // results later, so several open ids at once is normal, not malformed.
    const events = [
      ev({ type: 'tool_use', id: 'c1', name: 'read_file', input: {} }),
      ev({ type: 'tool_use', id: 'c2', name: 'read_file', input: {} }),
    ]
    expect([...openToolCalls(events, true)].sort()).toEqual(['c1', 'c2'])
  })
})