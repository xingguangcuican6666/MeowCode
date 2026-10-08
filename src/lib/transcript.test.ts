import { describe, it, expect } from 'vitest'
import { flattenMessages } from './transcript'
import { setLang } from './i18n'
import type { Message } from '../types'

// The two kinds of fold default in OPPOSITE directions: a merged activity run
// (read/bash/grep) starts collapsed, a write/edit diff starts open. The clicked
// set is shared between them, so every call site has to resolve the polarity
// against the default rather than read membership as "expanded" — when it did,
// a diff could only ever open and, under `verbose`, no fold could close at all.
describe('fold polarity', () => {
  const m = (id: string, role: Message['role'], content: string, meta?: Message['meta']): Message =>
    ({ id, role, content, meta })

  const readRun = (): Message[] => [
    m('a', 'tool', '● read_file · src/app.tsx'),
    m('b', 'tool', '⎿ 1: export const x = 1'),
    m('c', 'tool', '● grep · TODO'),
    m('d', 'tool', '⎿ src/a.ts:1: // TODO'),
  ]

  // write/edit is NOT a mergeable tool, so it renders as a header + diff. A diff
  // exists only when the result carries one, which the real tool sets in meta.
  const diffRun = (): Message[] => [
    m('w', 'tool', '● write_file · src/a.ts'),
    m('x', 'tool', '⎿ wrote 2 lines', {
      diff: [
        { tag: 'hunk', text: '@@ -1 +1 @@' },
        { tag: 'del', oldNo: 1, text: 'old' },
        { tag: 'add', newNo: 1, text: 'new' },
      ],
    }),
  ]

  const has = (lines: ReturnType<typeof flattenMessages>, s: string): boolean =>
    lines.some((l) => l.text.includes(s))

  it('a merged activity run starts collapsed and a click expands it', () => {
    const closed = flattenMessages(readRun(), 80)
    expect(has(closed, 'src/a.ts:1: // TODO')).toBe(false)
    const open = flattenMessages(readRun(), 80, { expanded: new Set(['a']) })
    expect(has(open, 'src/a.ts:1: // TODO')).toBe(true)
  })

  it('a diff starts open and a click COLLAPSES it', () => {
    const open = flattenMessages(diffRun(), 80)
    expect(has(open, '- old')).toBe(true)
    expect(has(open, '+ new')).toBe(true)
    const closed = flattenMessages(diffRun(), 80, { expanded: new Set(['w']) })
    expect(has(closed, '+ new')).toBe(false)
    // The summary line the user clicks to reopen it survives either way.
    expect(has(closed, 'wrote 2 lines')).toBe(true)
  })

  it('verbose opens everything, and a click still closes it', () => {
    // This is the regression: `verbose` forced every fold open, so with
    // expandAll true a click could only ever re-add the id and nothing collapsed.
    const verbose = flattenMessages(readRun(), 80, { expandAll: true })
    expect(has(verbose, 'src/a.ts:1: // TODO')).toBe(true)
    const folded = flattenMessages(readRun(), 80, { expandAll: true, expanded: new Set(['a']) })
    expect(has(folded, 'src/a.ts:1: // TODO')).toBe(false)

    const verboseDiff = flattenMessages(diffRun(), 80, { expandAll: true })
    expect(has(verboseDiff, '+ new')).toBe(true)
    const foldedDiff = flattenMessages(diffRun(), 80, { expandAll: true, expanded: new Set(['w']) })
    expect(has(foldedDiff, '+ new')).toBe(false)
  })

  it('merges adjacent read-only tools into ONE fold, addressed by the first id', () => {
    // Transcripts group a RUN of adjacent mergeable tools (Read, then Grep), so a
    // run has several ids and only the first one opens it — clicking a row inside
    // such a run toggles that run's own id (app.tsx reads it off the clicked
    // FlatLine, whose first row carries the run's group). Assert the address so a
    // reader doesn't assume 'c' works too.
    expect(has(flattenMessages(readRun(), 80, { expanded: new Set(['c']) }), 'src/a.ts:1: // TODO')).toBe(false)
    expect(has(flattenMessages(readRun(), 80, { expanded: new Set(['a']) }), 'src/a.ts:1: // TODO')).toBe(true)
  })

  it('leaves a non-collapsible row alone', () => {
    setLang('en')
    const lines = flattenMessages([m('z', 'assistant', 'hello there')], 80, { expanded: new Set(['z']) })
    expect(has(lines, 'hello there')).toBe(true)
  })
})