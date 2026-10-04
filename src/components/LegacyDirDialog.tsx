import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdin, useStdout } from 'ink'
import { PICKER_MOTION_ON, PICKER_MOTION_OFF } from '../lib/termmodes'
import { decodeInput } from '../lib/inkinput'
import { useTheme } from '../theme'
import { useT } from '../lib/i18n'
import { truncateToWidth, wrapToWidth } from '../lib/text'
import type { LegacyChoice, LegacyDirInfo } from '../lib/legacyDir'

// One-time startup dialog: this tool used to be called AnyCode, and a user
// upgrading from that era would otherwise silently start with an empty history
// because the build now reads ~/.meowcode only. cli.tsx mounts this before the
// TUI (and before the entry is resolved), so lib/legacyDir.ts's merge logic can
// run on the answer.
//
// It is a normal Ink picker — arrow keys / 1-2 / y-n / enter, plus the mouse
// wiring every other picker here uses (hover to highlight, click to confirm,
// wheel to move). cli.tsx mounts it on the alternate screen, in the TUI's own
// theme and language, so the frame starts at row 1 and vanishes on exit.
export { type LegacyChoice } from '../lib/legacyDir'

const OPTIONS: LegacyChoice[] = ['merge', 'skip']

const PAD = 1 // paddingX: content col c ↔ 1-based screen x = c + PAD + 1

// The old dir can hold a dozen top-level names; list enough to recognize what
// it is, then summarize the rest so the dialog never grows past one screen.
const MAX_ITEMS = 8

interface Props {
  info: LegacyDirInfo
  // Destination dir, passed in rather than imported: cli.tsx owns the question
  // and lib/legacyDir stays a plain (testable, DOM-free) module.
  dest: string
  onDone: (choice: LegacyChoice) => void
}

export function LegacyDirDialog({ info, dest, onDone }: Props): React.ReactElement {
  const colors = useTheme()
  const t = useT()
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const [index, setIndex] = useState(0)
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone
  // The confirmed option is read from a ref, not from `index`: Ink hands
  // useInput a whole read chunk as ONE `input` string, so a fast "2↵" arrives as
  // "2\r" and a setIndex earlier in the same call has not re-rendered by the time
  // ↵ is read. Every cursor move therefore writes the ref as well as the state.
  const indexRef = useRef(index); indexRef.current = index
  const move = (delta: number): void => select(indexRef.current + delta)
  function select(i: number): void {
    const n = ((i % OPTIONS.length) + OPTIONS.length) % OPTIONS.length
    indexRef.current = n
    setIndex(n)
  }

  // One column short of the terminal, like App: bordered/stretched boxes at
  // width === cols can wrap and land a second physical row the erase misses.
  const [width, setWidth] = useState(() => Math.max(24, (stdout?.columns ?? 80) - 1))
  useEffect(() => {
    if (!stdout) return
    const onResize = (): void => setWidth(Math.max(24, (stdout.columns ?? 80) - 1))
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])

  // Pre-wrap every line ourselves so the on-screen row count is known before
  // rendering — the mouse hit-test below maps a screen row back to an option,
  // and letting Ink soft-wrap would make that geometry a guess.
  const inner = Math.max(16, width - PAD * 2)
  const why = wrapToWidth(t('legacy.why', { old: info.dir, new: dest }), inner)
  const shown = info.present.slice(0, MAX_ITEMS)
  const more = info.present.length - shown.length
  const items = [
    ...shown.map((n) => truncateToWidth(n, inner - PAD)),
    ...(more > 0 ? [truncateToWidth(t('legacy.more', { n: more }), inner - PAD)] : []),
  ]
  if (items.length === 0) items.push(truncateToWidth(t('legacy.empty'), inner - PAD))
  const labels = [
    truncateToWidth(t('legacy.merge', { new: dest }), inner - PAD - 4),
    truncateToWidth(t('legacy.skip'), inner - PAD - 4),
  ]

  // Screen-row geometry for mouse hit-testing, derived from the same line arrays
  // we render. Above the first option: title(1) + why(N) + blank(1) +
  // "found:"(1) + items(M) + blank(1), then +1 because SGR y is 1-based. The
  // frame starts at row 1 because cli.tsx mounts this on the alternate screen.
  const firstItemRow = 5 + why.length + items.length
  const layoutRef = useRef({ firstItemRow, lastItemRow: firstItemRow + OPTIONS.length - 1 })
  layoutRef.current = { firstItemRow, lastItemRow: firstItemRow + OPTIONS.length - 1 }

  // Decode the chunk through lib/keychunks rather than leaning on `key`. Ink
  // hands useInput one whole read chunk as a single `input`, and its
  // parseKeypress reports just ONE keypress for it: "2\r" arrives as name="" /
  // input="2\r", and "\x1b[B\r" as name="down" / input="". So `key.return` is
  // false for a fast "2⏎" and every key after the first is silently swallowed.
  // A plain "↑" goes the other way and arrives as input="" — decodeInput takes
  // both of Ink's arguments so neither case is lost.
  const answer = (choice: LegacyChoice): void => onDoneRef.current(choice)
  useInput((input, key) => {
    decodeInput({ input, key }, {
      onEscape: () => answer('skip'),
      onUp: () => move(-1),
      onDown: () => move(1),
      onPageUp: () => move(-OPTIONS.length),
      onPageDown: () => move(OPTIONS.length),
      onReturn: () => answer(OPTIONS[indexRef.current]),
      onChar: (ch) => {
        if (ch === 'y' || ch === 'Y') answer('merge')
        else if (ch === 'n' || ch === 'N') answer('skip')
        else if (ch >= '1' && ch <= String(OPTIONS.length)) select(Number(ch) - 1)
      },
    })
  })

  // Mouse: hover moves the highlight, click selects, wheel moves the cursor.
  // Enable any-motion reporting (?1003h) on mount; on unmount re-assert the
  // app's base modes (?1000h?1002h?1006h) — a bare ?1003l clears tracking
  // entirely on some terminals (see lib/termmodes).
  useEffect(() => {
    const out = process.stdout
    try { out.write(PICKER_MOTION_ON) } catch { /* best-effort */ }
    const onData = (buf: Buffer): void => {
      const s = buf.toString('utf8')
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
      let m: RegExpExecArray | null
      while ((m = re.exec(s)) !== null) {
        const L = layoutRef.current
        const b = Number(m[1]); const y = Number(m[3]); const release = m[4] === 'm'
        if (b === 64 || b === 65) {
          move(b === 65 ? 1 : -1)
          continue
        }
        // No cursor position → no absolute row to hit-test against; leave the
        // wheel working and let the keyboard answer.
        if (L.firstItemRow <= 0) continue
        if (y >= L.firstItemRow && y <= L.lastItemRow) {
          const real = y - L.firstItemRow
          if (release) onDoneRef.current(OPTIONS[real])
          else select(real)
        }
      }
    }
    stdin?.on('data', onData)
    return () => { stdin?.off('data', onData); try { out.write(PICKER_MOTION_OFF) } catch { /* best-effort */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin])

  return (
    <Box flexDirection="column" width={width} paddingX={PAD}>
      <Text bold color={colors.warning} wrap="truncate">⚠ {t('legacy.title')}</Text>
      {why.map((line, i) => <Text key={i} color={colors.dim} wrap="truncate">{line}</Text>)}
      <Text> </Text>
      <Text color={colors.dim} wrap="truncate">{t('legacy.found')}</Text>
      {items.map((line, i) => <Text key={i} color={colors.text} wrap="truncate">{`  ${line}`}</Text>)}
      <Text> </Text>
      {OPTIONS.map((o, i) => {
        const cursor = i === index
        return (
          <Text key={o} color={cursor ? colors.accentBright : colors.text} wrap="truncate">
            {cursor ? '❯ ' : '  '}{i + 1}. {labels[i]}
          </Text>
        )
      })}
      <Text> </Text>
      <Text color={colors.dim} wrap="truncate">{truncateToWidth(t('legacy.later', { old: info.dir, new: dest }), inner)}</Text>
      <Text color={colors.dim} wrap="truncate">{truncateToWidth(t('legacy.footer'), inner)}</Text>
    </Box>
  )
}