import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdin } from 'ink'
import { useTheme } from '../theme'
import { useT } from '../hooks/useT'
import { truncateToWidth } from '../lib/text'
import { PICKER_MOTION_ON, PICKER_MOTION_OFF } from '../lib/termmodes'
import type { UserQuestion } from '../types'

interface Props {
  questions: UserQuestion[]
  width: number
  // Terminal height, so the preview panel can budget rows instead of growing the
  // dialog past the screen (app.tsx passes dims.rows).
  rows?: number
  // Screen rows rendered BELOW the dialog's bottom border. The dialog sits in the
  // input slot at the bottom of app.tsx's cluster, so hit-testing anchors on the
  // screen BOTTOM (dims.rows - bottomOffset) rather than a screen top — the same
  // anchoring PromptInput's in-box selection uses. 0 = the dialog is the last
  // thing on screen.
  bottomOffset?: number
  // Resolve with one answer array per question (chosen labels / typed text).
  onSubmit: (answers: string[][]) => void
  // Whole prompt dismissed (esc at the option list) → the tool reports no answer.
  onCancel: () => void
}

// Rows the dialog spends on everything that is NOT the preview panel: borders
// (2) + header (1) + blank (1) + question (1) + blank (1) + one row per option
// (label + optional description) + the "Other" row (1) + blank (1) + footer (1).
// A preview gets whatever is left, capped so a long panel scrolls in place rather
// than pushing the footer off the bottom of the terminal.
//
// On a terminal too short to fit the chrome at all, `chrome > rows` and no
// positive budget exists — the preview is dropped rather than pushed off-screen,
// and the caller falls back to letting the box overflow (every row readable,
// the tail scrolled by the terminal) instead of clipping the option list.
function previewRows(q: UserQuestion, rows: number | undefined): number {
  if (!hasPreview(q)) return 0
  const optRows = q.options.reduce((n, o) => n + 1 + (o.description ? 1 : 0), 0)
  const chrome = 2 + 1 + 1 + 1 + 1 + optRows + 1 + 1 + 1
  const avail = (rows ?? 24) - chrome - 2 // -2: leave the footer + perm indicator visible
  if (avail < 3) return 0
  return Math.min(12, avail)
}

const hasPreview = (q: UserQuestion): boolean =>
  Boolean(q.preview && q.preview.trim()) || q.options.some((o) => o.preview && o.preview.trim())

// The plain-text panel for the question: the currently selected option's own
// preview when it has one, else the question-level preview. Scrolled with the
// scroll keys, and windowed to `rows` with the first line pinned.
function PreviewPanel({
  text,
  rows,
  width,
  offset,
}: {
  text: string
  rows: number
  width: number
  offset: number
}): React.ReactElement {
  const colors = useTheme()
  const inner = Math.max(8, width - 6)
  const all = text.replace(/\r\n|\r/g, '\n').split('\n')
  const start = Math.max(0, Math.min(offset, Math.max(0, all.length - rows)))
  const visible = all.slice(start, start + rows)
  const more = all.length - rows - start
  return (
    <Box flexDirection="column" marginTop={1}>
      {visible.map((l, i) => (
        <Text key={i} color={colors.dim} wrap="truncate">{truncateToWidth(l, inner)}</Text>
      ))}
      {more > 0 || start > 0 ? (
        <Text color={colors.dim} wrap="truncate">
          {'  '}
          {start > 0 ? '↑ ' : ''}
          {start + 1}-{start + visible.length}/{all.length}
          {more > 0 ? ` · ↓ ${more} more` : ''}
        </Text>
      ) : null}
    </Box>
  )
}

// Inline structured-question prompt for the `ask_user` tool, rendered in place of
// the input box (mirroring PermissionDialog). It steps through the questions one
// at a time. Each shows its options plus a trailing "Other" row that opens a
// free-form text field, and — when the model attached one — a plain-text/ASCII
// preview panel above the list. Single-select confirms on ↵; multi-select toggles
// rows with space and confirms the set with ↵. Keyboard-only; it owns all keys
// while open (App's useInput early-returns on it).
export function AskUserDialog({ questions, width, rows, bottomOffset = 0, onSubmit, onCancel }: Props): React.ReactElement {
  const colors = useTheme()
  const t = useT()
  const { stdin } = useStdin()
  const [step, setStep] = useState(0)
  const [results, setResults] = useState<string[][]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [pScroll, setPScroll] = useState(0)

  const q = questions[step]
  const multi = q.multiSelect === true
  const otherIndex = q.options.length      // the synthetic "Other" row sits last
  const rowCount = q.options.length + 1
  // Per-option preview wins over the question-level one.
  const preview = (q.options[index]?.preview?.trim() ? q.options[index]!.preview! : q.preview) ?? ''
  const pRows = previewRows(q, rows)

  // Callbacks read from refs so the stdin listener (attached once) always sees the
  // current turn's handlers — same pattern as EntryPicker.
  const typingRef = useRef(typing); typingRef.current = typing
  const rowsRef = useRef(rows); rowsRef.current = rows
  const bottomOffsetRef = useRef(bottomOffset); bottomOffsetRef.current = bottomOffset
  // Which question the dialog is on + how many options it has, so the hit-test
  // reads live geometry rather than a captured first render.
  const geomRef = useRef({ step, rowCount, pRows })
  geomRef.current = { step, rowCount, pRows }

  const advance = (answer: string[]): void => {
    const next = [...results, answer]
    if (step + 1 >= questions.length) { onSubmit(next); return }
    setResults(next)
    setStep(step + 1)
    setIndex(0)
    setSelected(new Set())
    setTyping(false)
    setDraft('')
    setPScroll(0)
  }

  const confirmDraft = (): void => {
    const text = draft.trim()
    if (multi) {
      const labels = [...selected].sort((a, b) => a - b).map((i) => q.options[i].label)
      if (text) labels.push(text)
      advance(labels)
    } else {
      advance(text ? [text] : [])
    }
  }

  // Confirm the option at `i`. Takes the row as an argument so the mouse path can
  // confirm a row it just set the highlight to — within one chunk, a setIndex has
  // not re-rendered yet, so reading `index` would still see the old value.
  const confirmOptions = (i: number = index): void => {
    if (i === otherIndex) { setTyping(true); setDraft(''); return }
    if (multi) {
      const chosen = selected.size > 0 ? [...selected] : [i]
      advance(chosen.sort((a, b) => a - b).map((n) => q.options[n].label))
    } else {
      advance([q.options[i].label])
    }
  }
  const confirmOptionsRef = useRef(confirmOptions); confirmOptionsRef.current = confirmOptions

  // Mouse: hover moves the highlight, click confirms, wheel scrolls the preview.
  // Ink never surfaces mouse events to useInput, so read them off stdin directly —
  // the same SGR shape every picker in this app parses. app.tsx skips transcript
  // mouse handling while a dialog owns the keyboard, so this listener owns the
  // pointer for as long as it is mounted. Enable any-motion reporting (?1003h) so
  // hover works, and re-assert the app's base modes on unmount so the wheel keeps
  // scrolling the transcript instead of falling back to ↑/↓.
  useEffect(() => {
    if (!stdin) return
    const out = process.stdout
    try { out.write(PICKER_MOTION_ON) } catch { /* best-effort */ }
    const onData = (buf: Buffer): void => {
      const chunk = buf.toString('utf8')
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
      let m: RegExpExecArray | null
      while ((m = re.exec(chunk)) !== null) {
        const g = geomRef.current
        const b = Number(m[1])
        const y = Number(m[3])
        const release = m[4] === 'm'
        // The free-form field owns every key while it is open — including the
        // pointer, since a click on "Other" lands there.
        if (typingRef.current) continue
        // The dialog is bottom-anchored in app.tsx's cluster, so walk up from the
        // last row the cluster occupies. `rows` is the screen height; when the host
        // didn't pass one, treat the dialog as starting at row 1.
        const screenRows = rowsRef.current ?? 0
        if (screenRows <= 0) continue
        // Rows below the dialog's own content, from the bottom of the screen up:
        // the border (1), then the cluster rows app.tsx renders under it.
        const dialogBottom = screenRows - bottomOffsetRef.current
        // Rows from the bottom border UP to the first option row, excluding the
        // option rows themselves: the border, the footer and its marginTop, the
        // "Other" row, and — while the free-form field is open — its three rows.
        // Counting up from the bottom keeps this right however the list above it
        // grows (a preview panel, a longer question, a taller terminal).
        const opts = questions[g.step].options
        const optRows = (n: number): number =>
          opts.slice(0, n).reduce((acc, o) => acc + (o.description ? 2 : 1), 0)
        const belowFirstOption =
          1 + // bottom border
          1 + // footer hint
          1 + // the footer's marginTop
          1 + // the "Other" row
          (typingRef.current ? 3 : 0) // marginTop + prompt + draft line
        // Screen row (1-based) of the first option's label.
        const firstOptRow = dialogBottom - belowFirstOption - optRows(opts.length) + 1
        if (b === 64 || b === 65) {
          const stepN = Math.max(1, g.pRows - 1)
          setPScroll((s) => Math.max(0, b === 65 ? s + stepN : s - stepN))
          continue
        }
        // Left button only (0 press / 1 release); other buttons must not act.
        if (b !== 0 && b !== 1) continue
        // Map a screen row back to an option index: each option owns its label row
        // plus a description row when it has one. Walk the option rows downward.
        let hit = -1
        for (let i = 0; i < opts.length; i++) {
          const top = firstOptRow + optRows(i)
          const span = opts[i].description ? 2 : 1
          if (y >= top && y < top + span) { hit = i; break }
        }
        // One row past the last option's block is the "Other" row.
        const otherRow = firstOptRow + optRows(opts.length)
        if (hit < 0 && y === otherRow) hit = g.rowCount - 1
        if (hit < 0) continue
        setIndex(hit)
        setPScroll(0)
        if (release) confirmOptionsRef.current(hit)
      }
    }
    stdin.on('data', onData)
    return () => { stdin.off('data', onData); try { out.write(PICKER_MOTION_OFF) } catch { /* best-effort */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin])

  useInput((ch, key) => {
    if (typing) {
      if (key.return) { confirmDraft(); return }
      if (key.escape) { setTyping(false); setDraft(''); return }
      if (key.backspace || key.delete) { setDraft((d) => d.slice(0, -1)); return }
      if (ch && !key.ctrl && !key.meta && ch >= ' ') setDraft((d) => d + ch)
      return
    }
    if (key.escape) { onCancel(); return }
    if (key.pageUp) { setPScroll((s) => Math.max(0, s - Math.max(1, pRows - 1))); return }
    if (key.pageDown) { setPScroll((s) => s + Math.max(1, pRows - 1)); return }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); setPScroll(0); return }
    if (key.downArrow) { setIndex((i) => Math.min(rowCount - 1, i + 1)); setPScroll(0); return }
    if (ch === ' ' && multi && index !== otherIndex) {
      setSelected((s) => { const n = new Set(s); if (n.has(index)) { n.delete(index) } else { n.add(index) } return n })
      return
    }
    if (key.return) { confirmOptions(); return }
  })

  return (
    <Box flexDirection="column" width={width} paddingX={1} borderStyle="round" borderColor={colors.accent}>
      <Box justifyContent="space-between">
        <Text color={colors.accentBright} bold>? {t('ask.title')}</Text>
        {questions.length > 1 ? <Text color={colors.dim}>{t('ask.progress', { n: step + 1, total: questions.length })}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.text} bold>{q.question}{multi ? <Text color={colors.dim}> {t('ask.multiHint')}</Text> : null}</Text>
      </Box>
      {preview.trim() && pRows > 0 ? (
        <PreviewPanel text={preview} rows={pRows} width={width} offset={pScroll} />
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {q.options.map((o, i) => {
          const on = i === index
          const box = multi ? (selected.has(i) ? '[x] ' : '[ ] ') : ''
          return (
            <Box key={i} flexDirection="column">
              <Text color={on ? colors.accentBright : colors.text} bold={on} wrap="truncate">
                {on ? '❯ ' : '  '}{box}{o.label}
              </Text>
              {o.description ? (
                <Text color={colors.dim} wrap="truncate">{'    '}{o.description}</Text>
              ) : null}
            </Box>
          )
        })}
        <Text color={index === otherIndex ? colors.accentBright : colors.dim} bold={index === otherIndex} wrap="truncate">
          {index === otherIndex ? '❯ ' : '  '}{multi ? '    ' : ''}{t('ask.other')}
        </Text>
      </Box>
      {typing ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.dim}>{t('ask.otherPrompt')}</Text>
          <Text color={colors.text}>{'> '}{draft}<Text color={colors.accentBright}>▏</Text></Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={colors.dim} wrap="truncate">{t(multi ? 'ask.footerMulti' : 'ask.footerSingle')}</Text>
      </Box>
    </Box>
  )
}
