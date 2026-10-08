import { describe, it, expect } from 'vitest'
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { renderToFrames } from './ink-harness'

describe('ink harness', () => {
  it('captures the rendered frame', async () => {
    const h = renderToFrames(<Text>hello</Text>, { cols: 20, rows: 4 })
    expect((await h.frame())[0]).toBe('hello')
    h.unmount()
  })

  it('delivers typed bytes to useInput', async () => {
    function Counter(): React.ReactElement {
      const [n, setN] = useState(0)
      useInput((ch, key) => { if (key.downArrow) setN((v) => v + 1) })
      return <Text>count={n}</Text>
    }
    const h = renderToFrames(<Counter />, { cols: 20, rows: 4 })
    expect((await h.frame())[0]).toBe('count=0')
    h.type('\x1b[B')
    expect((await h.frame())[0]).toBe('count=1')
    h.unmount()
  })

  it('shows the full option list when a dialog needs more rows than a short screen has', async () => {
    // app.tsx renders ask_user / the permission prompt INSTEAD of the input box, so
    // the bottom cluster grows past `clusterH`'s estimate. With the cluster pinned
    // (flexShrink={0}) Ink clips the bottom of an over-tall tree rather than
    // squashing the middle rows — so what survives is the option list, not a
    // jumble. This is the "only the last option coloured, can't scroll" report.
    function Dialog({ shrink }: { shrink: boolean }): React.ReactElement {
      const options = ['Web Audio API', 'Howler.js', 'Tone.js', 'Other']
      return (
        <Box flexDirection="column" width={40} height={12}>
          <Box flexGrow={1} flexDirection="column" overflow="hidden" justifyContent="flex-end">
            <Text>transcript</Text>
          </Box>
          <Box flexDirection="column" flexShrink={shrink ? 0 : undefined}>
            <Box borderStyle="round" paddingX={1} flexDirection="column" width={40}>
              <Text>? question</Text>
              {options.map((o, i) => <Text key={i}>{i === 0 ? '❯ ' : '  '}{o}</Text>)}
              <Text>descr A</Text>
              <Text>descr B</Text>
              <Text>descr C</Text>
              <Text>footer hint</Text>
            </Box>
            <Text>footer</Text>
          </Box>
        </Box>
      )
    }
    const fixedH = renderToFrames(<Dialog shrink />, { cols: 40, rows: 12 })
    const fixed = await fixedH.frame()
    // Every option row survives, one per line (no two squashed onto one row).
    for (const o of ['Web Audio API', 'Howler.js', 'Tone.js', 'Other']) {
      expect(fixed.filter((r) => r.includes(o)).length).toBe(1)
    }
    const squeezed = await renderToFrames(<Dialog shrink={false} />, { cols: 40, rows: 12 }).frame()
    // Without the pin the cluster is squeezed instead: rows lose their box border
    // and the first content row is overwritten — the "多行覆写单行" symptom.
    expect(squeezed.some((r) => r.includes('? question'))).toBe(false)
    expect(squeezed.filter((r) => r.includes('descr A')).length).toBe(1)
    // With the pin nothing is overwritten: the whole dialog fits.
    expect(fixed.some((r) => r.includes('? question'))).toBe(true)
    expect(fixed.some((r) => r.includes('descr A'))).toBe(true)
  })

  it('shows a column whose child grows without the box squashing its rows', async () => {
    // The bug this guards: a bottom cluster in a fixed-height column. When its
    // input box grows from one row to two, the extra row must come out of the
    // flexGrow viewport — not by squeezing the cluster's own rows together.
    function Cluster({ inputRows, shrink }: { inputRows: number; shrink: boolean }): React.ReactElement {
      return (
        <Box flexDirection="column" width={40} height={10}>
          <Box flexGrow={1} flexDirection="column" overflow="hidden" justifyContent="flex-end">
            {Array.from({ length: 40 }, (_, i) => <Text key={i}>transcript {i}</Text>)}
          </Box>
          <Box flexDirection="column" flexShrink={shrink ? 0 : undefined}>
            <Box borderStyle="round" paddingX={1} flexDirection="column" width={40}>
              {Array.from({ length: inputRows }, (_, i) => <Text key={i}>{`> line ${i}`}</Text>)}
            </Box>
            <Text>footer</Text>
          </Box>
        </Box>
      )
    }
    const bad = renderToFrames(<Cluster inputRows={2} shrink={false} />, { cols: 40, rows: 10 })
    const good = renderToFrames(<Cluster inputRows={2} shrink />, { cols: 40, rows: 10 })
    const badRows = await bad.frame()
    const goodRows = await good.frame()
    // Without flexShrink={0} the cluster is squeezed: the box's own rows collapse
    // onto each other and the footer lands on the border.
    expect(badRows).toHaveLength(10)
    expect(goodRows.filter((r) => r.includes('> line')).length).toBe(2)
    expect(goodRows).toContain('footer')
    expect(goodRows).toContain('╰──────────────────────────────────────╯')
    bad.unmount(); good.unmount()
  })
})
