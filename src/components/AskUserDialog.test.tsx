import { describe, it, expect } from 'vitest'
import React from 'react'
import { Box, Text } from 'ink'
import { renderToFrames } from '../lib/ink-harness'
import { AskUserDialog } from './AskUserDialog'
import { ThemeProvider, getTheme } from '../theme'
import { LangProvider } from '../hooks/useT'
import { resolveLang } from '../lib/i18n'
import type { UserQuestion } from '../types'

const colors = getTheme('auto').colors
const lang = resolveLang('zh')

function wrap(node: React.ReactElement, screenRows: number, width = 56): React.ReactElement {
  // app.tsx's shape: fixed-height root, flexGrow+overflow:hidden viewport, and a
  // bottom cluster (flexShrink={0}) holding the dialog in place of the input box.
  return (
    <ThemeProvider value={colors}>
      <LangProvider value={lang}>
        <Box flexDirection="column" width={width} height={screenRows}>
          <Box flexGrow={1} flexDirection="column" overflow="hidden" justifyContent="flex-end">
            <Text>transcript line</Text>
          </Box>
          <Box flexDirection="column" flexShrink={0}>
            <Box><Text> </Text></Box>
            <AskUserDialog
              questions={QUESTIONS}
              width={width}
              rows={screenRows}
              onSubmit={() => {}}
              onCancel={() => {}}
            />
            <Text>footer</Text>
            <Text>permission indicator</Text>
          </Box>
        </Box>
      </LangProvider>
    </ThemeProvider>
  )
}

const QUESTIONS: UserQuestion[] = [{
  question: 'Which audio stack?',
  header: 'Audio',
  preview: 'A. native\n   ├─ AudioContext\n   └─ zero deps\nB. wrapper\nC. framework',
  options: [
    { label: 'Web Audio API', description: 'Native, no deps', preview: 'new AudioContext()' },
    { label: 'Howler.js', description: 'Small wrapper' },
    { label: 'Tone.js', description: 'Full framework' },
  ],
}]

const bodies = (frame: string[]): string => frame.filter((r) => r.startsWith('│')).join('\n')

describe('AskUserDialog', () => {
  it('moves the highlight with ↑/↓ and keeps the dialog rows intact on a short screen', async () => {
    // The squeeze bug: on a terminal too short for the dialog, a shrinkable
    // bottom cluster collapsed the option rows onto each other and overwrote the
    // footer — which read as "only the last option is coloured" and no scrolling.
    const h = renderToFrames(wrap(<></>, 24), { cols: 56, rows: 24 })
    expect(bodies(await h.frame())).toContain('❯ Web Audio API')

    h.type('\x1b[A') // up at the top stays put
    expect(bodies(await h.frame())).toContain('❯ Web Audio API')

    h.type('\x1b[B') // down → Howler.js
    let frame = await h.frame()
    expect(frame.some((r) => r.includes('❯ Howler.js'))).toBe(true)
    expect(frame.some((r) => r.includes('❯ Web Audio API'))).toBe(false)

    h.type('\x1b[B') // down → Tone.js
    frame = await h.frame()
    expect(frame.some((r) => r.includes('❯ Tone.js'))).toBe(true)

    h.type('\x1b[B') // down → Other (last row)
    frame = await h.frame()
    expect(frame.some((r) => r.includes('❯ 其它'))).toBe(true)

    h.type('\r') // Other opens the free-form field
    frame = await h.frame()
    expect(frame.some((r) => r.includes('输入你的答案'))).toBe(true)
    h.unmount()
  })

  it('shows the selected option\'s preview, falling back to the question preview', async () => {
    const h = renderToFrames(wrap(<></>, 26), { cols: 56, rows: 26 })
    expect(bodies(await h.frame())).toContain('new AudioContext()') // option 0's own preview

    h.type('\x1b[B') // option 1 has none → question-level preview
    const frame = await h.frame()
    expect(frame.some((r) => r.includes('B. wrapper'))).toBe(true)
    expect(frame.some((r) => r.includes('new AudioContext()'))).toBe(false)
    h.unmount()
  })

  it('renders a long preview in a bounded window that PageDown scrolls', async () => {
    const long: UserQuestion[] = [{
      question: 'Which audio stack?',
      header: 'Audio',
      preview: Array.from({ length: 30 }, (_, i) => `line ${String(i).padStart(2, '0')}`).join('\n'),
      options: [{ label: 'A' }, { label: 'B' }],
    }]
    const h = renderToFrames(
      <ThemeProvider value={colors}>
        <LangProvider value={lang}>
          <AskUserDialog questions={long} width={56} rows={26} onSubmit={() => {}} onCancel={() => {}} />
        </LangProvider>
      </ThemeProvider>,
      { cols: 56, rows: 26 },
    )
    const frame = await h.frame()
    expect(frame.some((r) => r.includes('line 00'))).toBe(true)
    expect(frame.some((r) => /\d+-\d+\/30/.test(r))).toBe(true)
    expect(frame.some((r) => r.includes('line 29'))).toBe(false)
    h.type('\x1b[6~') // PageDown
    const after = await h.frame()
    expect(after.some((r) => r.includes('line 00'))).toBe(false)
    expect(after.some((r) => r.includes('line 11'))).toBe(true)
    expect(after.some((r) => /12-23\/30/.test(r))).toBe(true)
    h.unmount()
  })

  it('drops the preview on a screen too short for the dialog chrome', async () => {
    // With no positive row budget left the preview is dropped, so the option list
    // is what stays readable instead of the panel eating the whole dialog.
    const h = renderToFrames(wrap(<></>, 10), { cols: 56, rows: 10 })
    const body = bodies(await h.frame())
    expect(body).toContain('❯ Web Audio API')
    expect(body).toContain('Howler.js')
    expect(body).not.toContain('new AudioContext()')
    h.unmount()
  })

  it('overflows past the screen rather than collapsing its own rows', async () => {
    // Ink always draws exactly `rows` lines, so when the cluster is taller than the
    // screen the BOTTOM is cut. The rows that matter — the options the user is
    // choosing between — are pushed above the cut by dropping the preview.
    const h = renderToFrames(wrap(<></>, 16), { cols: 56, rows: 16 })
    const body = bodies(await h.frame())
    for (const label of ['❯ Web Audio API', 'Howler.js', 'Tone.js', '其它']) {
      expect(body).toContain(label)
    }
    h.unmount()
  })
})

// The dialog is bottom-anchored, so the click row comes from the FRAME rather than
// from a hand-computed offset — this asserts the geometry stays self-consistent
// (whatever row the label landed on is the row that accepts the click).
const rowOf = (frame: string[], needle: string): number =>
  frame.findIndex((r) => r.includes(needle)) + 1

describe('AskUserDialog mouse', () => {
  it('moves the highlight on press and confirms on release', async () => {
    let submitted: string[][] | null = null
    const h = renderToFrames(
      <ThemeProvider value={colors}>
        <LangProvider value={lang}>
          <Box flexDirection="column" width={56} height={24}>
            <Box flexGrow={1} />
            <Box flexDirection="column" flexShrink={0}>
              <AskUserDialog
                questions={QUESTIONS}
                width={56}
                rows={24}
                bottomOffset={2}
                onSubmit={(a) => { submitted = a }}
                onCancel={() => {}}
              />
              <Text>footer</Text>
              <Text>perm</Text>
            </Box>
          </Box>
        </LangProvider>
      </ThemeProvider>,
      { cols: 56, rows: 24 },
    )
    const frame = await h.frame()
    // Press on Tone.js's label → highlight moves there, nothing confirmed yet.
    const toneRow = rowOf(frame, 'Tone.js')
    expect(toneRow).toBeGreaterThan(0)
    h.type(`\x1b[<0;10;${toneRow}M`)
    const pressed = await h.frame()
    expect(pressed.some((r) => r.includes('❯ Tone.js'))).toBe(true)
    expect(submitted).toBe(null)

    // Release on the same row → confirms that option.
    h.type(`\x1b[<0;10;${toneRow}m`)
    await h.frame()
    expect(submitted).toEqual([['Tone.js']])
    h.unmount()
  })

  it('clicking "Other" opens the free-form field, and a wheel scrolls the preview', async () => {
    const h = renderToFrames(
      <ThemeProvider value={colors}>
        <LangProvider value={lang}>
          <Box flexDirection="column" width={56} height={24}>
            <Box flexGrow={1} />
            <Box flexDirection="column" flexShrink={0}>
              <AskUserDialog questions={QUESTIONS} width={56} rows={24} bottomOffset={2} onSubmit={() => {}} onCancel={() => {}} />
              <Text>footer</Text>
              <Text>perm</Text>
            </Box>
          </Box>
        </LangProvider>
      </ThemeProvider>,
      { cols: 56, rows: 24 },
    )
    let frame = await h.frame()
    h.type(`\x1b[<0;10;${rowOf(frame, '其它')}m`)
    frame = await h.frame()
    expect(frame.some((r) => r.includes('输入你的答案'))).toBe(true)

    // While typing, the wheel must not scroll the preview (the field owns input).
    const before = frame.some((r) => r.includes('1-1/3'))
    h.type('\x1b[<65;10;3M')
    frame = await h.frame()
    expect(frame.some((r) => r.includes('1-1/3'))).toBe(before)
    h.unmount()
  })

  it('ignores non-left buttons and clicks outside the option list', async () => {
    let submitted: string[][] | null = null
    const h = renderToFrames(
      <ThemeProvider value={colors}>
        <LangProvider value={lang}>
          <AskUserDialog questions={QUESTIONS} width={56} rows={24} onSubmit={(a) => { submitted = a }} onCancel={() => {}} />
        </LangProvider>
      </ThemeProvider>,
      { cols: 56, rows: 24 },
    )
    const frame = await h.frame()
    const howler = rowOf(frame, 'Howler.js')
    h.type(`\x1b[<2;10;${howler}M\x1b[<2;10;${howler}m`) // right button
    h.type(`\x1b[<0;10;1M\x1b[<0;10;1m`)                  // the dialog's top border row
    await h.frame()
    expect(submitted).toBe(null)
    expect((await h.frame()).some((r) => r.includes('❯ Web Audio API'))).toBe(true)
    h.unmount()
  })
})
