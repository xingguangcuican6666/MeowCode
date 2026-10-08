import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../theme'
import { useT } from '../hooks/useT'
import { truncateToWidth } from '../lib/text'
import type { UserQuestion } from '../types'

interface Props {
  questions: UserQuestion[]
  width: number
  // Terminal height, so the preview panel can budget rows instead of growing the
  // dialog past the screen (app.tsx passes dims.rows).
  rows?: number
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
export function AskUserDialog({ questions, width, rows, onSubmit, onCancel }: Props): React.ReactElement {
  const colors = useTheme()
  const t = useT()
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

  const confirmOptions = (): void => {
    if (index === otherIndex) { setTyping(true); setDraft(''); return }
    if (multi) {
      const chosen = selected.size > 0 ? [...selected] : [index]
      advance(chosen.sort((a, b) => a - b).map((i) => q.options[i].label))
    } else {
      advance([q.options[index].label])
    }
  }

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
