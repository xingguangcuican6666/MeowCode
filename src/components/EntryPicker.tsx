import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput, useStdin } from 'ink'
import { PICKER_MOTION_ON, PICKER_MOTION_OFF } from '../lib/termmodes'
import { decodeInput } from '../lib/inkinput'
import { useTheme } from '../theme'
import { useT } from '../hooks/useT'
import { truncateToWidth } from '../lib/text'
import { getDefaultEntry, listEntries, setDefaultEntry, type EntryMeta } from '../lib/entries'
import { EntryInstallError, removeEntry } from '../lib/entryInstall'

const PAD = 1

interface Props {
  width: number
  // One line into the transcript, localized by the caller (app.tsx owns `print`).
  print: (text: string, error?: boolean) => void
  onCancel: () => void
}

// The three states this overlay lives in, one mount: `list` picks an entry,
// `actions` operates on it, `details` reports what it is. Esc walks back up that
// ladder and then closes.
//
// There is deliberately NO "create" step: an entry is a whole front-end shipped
// by a plugin, not something the user types into existence. What you can install
// is decided by what plugins you have, so the list is a readout of the installed
// set — offering to hand-author one would invent an entry with no UI behind it.
// `meowcode entry install <source>` is the only way an entry appears.
type Step = 'list' | 'actions' | 'details'

type Action = 'setDefault' | 'clearDefault' | 'details' | 'remove'

// Row kinds in the two list-shaped steps, so the render and the mouse hit-test
// read off one array instead of two parallel ones that can drift.
interface Row {
  kind: 'entry' | 'action'
  entry?: EntryMeta
  action?: Action
}

// The whole point of the menu is to answer "which front-end am I switching to",
// so the name column gets the room; the marks are fixed-width so the names still
// line up across rows.
function marks(meta: EntryMeta, isDefault: boolean, t: ReturnType<typeof useT>): string {
  const parts: string[] = []
  if (isDefault) parts.push(t('cmd.entryDefaultSuffix'))
  if (meta.builtin) parts.push(t('cmd.entryBuiltinMark'))
  if (meta.hasLauncher) parts.push(t('cmd.entryLauncherMark'))
  return parts.join(' ')
}

// The /entry overlay. An entry is a complete front-end of its own — different UI,
// different wiring, optionally a launcher that replaces the TUI entirely — and
// sessions/memory are shared across them, so the only thing the menu changes is
// the startup binding, which is why every footer says switching needs a restart.
//
// Mirrors SessionPicker: arrows / digits / ↵, plus hover, click and wheel.
export function EntryPicker({ width, print, onCancel }: Props): React.ReactElement {
  const colors = useTheme()
  const t = useT()
  const { stdin } = useStdin()

  // Re-read the list each time we come back to `list`, so a remove inside the
  // menu is visible without remounting the overlay.
  const [step, setStep] = useState<Step>('list')
  const [entries, setEntries] = useState<EntryMeta[]>(() => listEntries())
  const [index, setIndex] = useState(0)
  // Which entry `actions` is acting on — captured on the way in, so esc back to
  // the list can still highlight it.
  const [picked, setPicked] = useState<string | null>(null)
  // Which row is being removed — the destructive action gets one more ↵.
  const [confirm, setConfirm] = useState(false)
  const onCancelRef = useRef(onCancel); onCancelRef.current = onCancel
  const printRef = useRef(print); printRef.current = print

  // Read from a ref, not from `index`: Ink hands useInput one whole read chunk,
  // so a setIndex earlier in the same chunk has not re-rendered by the time ↵ is
  // read (see lib/inkinput). Every cursor move writes both.
  const indexRef = useRef(index); indexRef.current = index
  const confirmRef = useRef(confirm); confirmRef.current = confirm

  const defaultsTo = (name: string | null): boolean => name !== null && getDefaultEntry() === name
  const pickedEntry: EntryMeta | undefined = entries.find((e) => e.name === picked)

  // What ↵ does in each step, and the rows it can act on. One function so the
  // keyboard and the mouse go through literally the same path.
  const openActions = (name: string): void => {
    setPicked(name)
    setIndex(0)
    setConfirm(false)
    setStep('actions')
  }

  const actionRows = (): Row[] => {
    const rows: Row[] = []
    // Making the current default the default again would be a no-op, so the
    // row flips to "clear it" instead.
    rows.push({ kind: 'action', entry: pickedEntry, action: defaultsTo(picked) ? 'clearDefault' : 'setDefault' })
    rows.push({ kind: 'action', entry: pickedEntry, action: 'details' })
    // The built-in entry is materialized on every startup, so a Remove row
    // could only ever fail — don't offer it.
    if (!pickedEntry?.builtin) rows.push({ kind: 'action', entry: pickedEntry, action: 'remove' })
    return rows
  }

  // What the details step shows. Kept as an array rather than one joined string
  // because the menu can wrap each line on its own; the transcript used to get
  // this as a single line, where "描述：A Web front-end for the same agent" and
  // "前台：…" ran together into an unreadable run-on.
  const detailLines = (): string[] => {
    const meta = pickedEntry
    if (!meta) return [t('entry.detailsNone', { name: picked ?? '' })]
    return [
      t('entry.detailsDir', { dir: meta.dir }),
      t('entry.detailsDesc', { desc: meta.description || t('entry.noDesc') }),
      defaultsTo(picked) ? t('entry.detailsDefault') : t('entry.detailsNotDefault'),
      meta.builtin ? t('entry.detailsBuiltin') : meta.hasLauncher ? t('entry.detailsLauncher') : t('entry.detailsPlain'),
      t('entry.detailsShared'),
    ]
  }

  const runAction = (row: Row | undefined): void => {
    if (!row || !row.entry) return
    const { name } = row.entry
    const action = row.action
    if (action === 'setDefault') {
      setDefaultEntry(name)
      printRef.current(t('cmd.entryDefaultSet', { name }))
      backTo('list')
    } else if (action === 'clearDefault') {
      setDefaultEntry(null)
      printRef.current(t('cmd.entryDefaultCleared'))
      backTo('list')
    } else if (action === 'details') {
      // Stay inside the overlay. This used to `print()` into the transcript and
      // drop straight back to the list — but the modal is drawn over the
      // transcript, so the press showed nothing at all and read as a dead key.
      // An action whose whole output is invisible is not an action.
      setStep('details')
    } else if (action === 'remove') {
      if (!confirmRef.current) { setConfirm(true); return } // one more ↵, so a
      // stray click on the row can't delete an entry — the list is still there.
      try {
        // --force: the guard against deleting per-entry sessions/memory is moot
        // (both are global now), and this is the explicit "remove" action.
        removeEntry(name, { force: true })
        printRef.current(t('entry.removed', { name }))
      } catch (e) {
        const msg = e instanceof EntryInstallError ? e.message : String(e)
        printRef.current(t('entry.removeFailed', { msg }), true)
      }
      setConfirm(false)
      const next = listEntries()
      setEntries(next)
      backTo('list', next)
    }
  }

  // Walk one rung down the ladder, restoring the cursor where it belongs.
  //
  // `openActions` has to zero the cursor because the action rows are a different
  // set, so without this a menu round-trip silently re-targets row 1 — esc would
  // jump the highlight off the entry you were just managing, and "set as default"
  // would leave the（默认）mark on a row the cursor isn't on. Coming back from
  // `details` keeps the row it came from (查看详情), and `list` is the list to
  // index into, which differs right after a remove.
  const backTo = (target: 'list' | 'actions', list: EntryMeta[] = entries): void => {
    setConfirm(false)
    let next: number
    if (target === 'list') {
      const i = list.findIndex((e) => e.name === picked)
      next = i >= 0 ? i : Math.min(indexRef.current, Math.max(0, list.length - 1))
    } else {
      next = Math.min(indexRef.current, Math.max(0, actionRows().length - 1))
    }
    indexRef.current = next
    setIndex(next)
    setStep(target)
  }

  const rows = step === 'actions' ? actionRows() : step === 'list' ? entries.map((e): Row => ({ kind: 'entry', entry: e })) : []
  const rowCount = rows.length
  // Clamp rather than modulo-scroll on the list step: a 2-entry list that
  // wrap-arrows is disorienting when the list can grow. (The action list is
  // fixed-length, so it wraps freely.)
  const move = (delta: number): void => {
    if (rowCount === 0) return
    const next = step === 'actions'
      ? (indexRef.current + delta + rowCount) % rowCount
      : Math.max(0, Math.min(rowCount - 1, indexRef.current + delta))
    indexRef.current = next
    setIndex(next)
  }
  const choose = (i: number): void => {
    if (i < 0 || i >= rowCount) return
    indexRef.current = i
    setIndex(i)
  }
  const activate = (): void => {
    const row = rows[indexRef.current]
    if (!row) return
    if (row.kind === 'entry' && row.entry) { openActions(row.entry.name); return }
    runAction(row)
  }

  // Keyboard. Decode the chunk rather than leaning on `key`: Ink's
  // parseKeypress reports ONE keypress per read, so a fast "2⏎" arrives as
  // name="" / input="2\r" (key.return false) and "\x1b[B\r" swallows the ⏎ —
  // while a plain "↑" arrives as input="" (key.upArrow true). decodeInput takes
  // both of Ink's arguments and gets each of those right.
  useInput((input, key) => {
    decodeInput({ input, key }, {
      onEscape: () => {
        if (step === 'details') { backTo('actions'); return }
        if (step === 'actions') { backTo('list'); return }
        onCancelRef.current()
      },
      onUp: () => move(-1),
      onDown: () => move(1),
      onPageUp: () => move(-rowCount),
      onPageDown: () => move(rowCount),
      onReturn: () => activate(),
      onChar: (ch) => {
        // Digits jump to a row, as in every other picker here. The row numbers
        // stop at 9 by design — the list stays small enough to scroll.
        if (ch >= '1' && ch <= '9') choose(Number(ch) - 1)
      },
    })
  })

  // Screen-row geometry for mouse hit-testing: title(1) / subtitle(2) / blank(3),
  // then one row per item. Every row renders as exactly ONE screen row (the
  // description rides on the cursor row rather than taking its own line), so this
  // is a plain offset and cannot drift from what is drawn. SGR y is 1-based and
  // the modal is top-anchored (app.tsx).
  const layoutRef = useRef({ starts: rows.map((_, i) => 4 + i), last: 3 + rowCount })
  layoutRef.current = { starts: rows.map((_, i) => 4 + i), last: 3 + rowCount }

  // Mouse: hover moves the highlight, click acts, wheel moves the cursor. Enable
  // any-motion reporting (?1003h) on mount; on unmount re-assert the app's base
  // modes (?1000h?1002h?1006h) so the wheel keeps scrolling the transcript.
  useEffect(() => {
    const out = process.stdout
    try { out.write(PICKER_MOTION_ON) } catch { /* best-effort */ }
    const onData = (buf: Buffer): void => {
      const s = buf.toString('utf8')
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
      let m: RegExpExecArray | null
      while ((m = re.exec(s)) !== null) {
        const L = layoutRef.current
        const b = Number(m[1]); const row = Number(m[3]); const release = m[4] === 'm'
        if (b === 64 || b === 65) { move(b === 65 ? 1 : -1); continue }
        // Left button only (b 0 press / 1 release); the middle/right numbers must
        // not act. No cursor position → no row to hit-test, so leave the wheel
        // working and let the keyboard answer.
        if (b !== 0 && b !== 1) continue
        // The last row start that is at or above the pointer: a click on a row's
        // description line still counts as that row.
        let hit = -1
        for (let i = 0; i < L.starts.length; i++) {
          if (L.starts[i] <= row && (i === L.starts.length - 1 || row < L.starts[i + 1])) { hit = i; break }
        }
        if (hit < 0) continue
        if (release) { choose(hit); activate() } else choose(hit)
      }
    }
    stdin?.on('data', onData)
    return () => { stdin?.off('data', onData); try { out.write(PICKER_MOTION_OFF) } catch { /* best-effort */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin])

  const inner = Math.max(20, width - PAD * 2)
  // Name column: two glyphs of cursor, "N. ", then the name and its marks. The
  // name is truncated to whatever room the marks leave, so a "（默认）[launcher]"
  // row never pushes the entry's own name off the edge.
  const labels = rows.map((r) => {
    if (r.kind === 'entry' && r.entry) return truncateToWidth(r.entry.name, Math.max(8, Math.floor(inner * 0.5) - 1)) + '  ' + marks(r.entry, defaultsTo(r.entry.name), t)
    return actionLabel(r.action as Action, t)
  })

  return (
    <Box flexDirection="column" width={width} paddingX={PAD}>
      {step === 'list' && (
        <>
          <Text bold color={colors.accent} wrap="truncate">{t('entry.title')}</Text>
          <Text color={colors.dim} wrap="truncate">{truncateToWidth(t('entry.subtitle'), inner)}</Text>
          <Text> </Text>
        </>
      )}
      {step === 'actions' && pickedEntry && (
        <>
          <Text bold color={colors.accent} wrap="truncate">
            {truncateToWidth(`${t('entry.actionsTitle', { name: pickedEntry.name })}  ${marks(pickedEntry, defaultsTo(pickedEntry.name), t)}`, inner)}
          </Text>
          <Text color={colors.dim} wrap="truncate">{truncateToWidth(pickedEntry.description || t('entry.noDesc'), inner)}</Text>
          <Text> </Text>
        </>
      )}
      {step === 'details' && pickedEntry && (
        <>
          <Text bold color={colors.accent} wrap="truncate">
            {truncateToWidth(`${t('entry.detailsTitle', { name: pickedEntry.name })}  ${marks(pickedEntry, defaultsTo(picked), t)}`, inner)}
          </Text>
          <Text> </Text>
          {detailLines().map((line, i) => (
            <Text key={i} color={colors.dim} wrap="truncate">
              {truncateToWidth(line, inner)}
            </Text>
          ))}
        </>
      )}
      {rows.map((r, i) => {
        const cursor = i === index
        const label = labels[i]
        const dim = r.kind !== 'entry'
        // The description rides on the cursor row instead of taking its own line:
        // one row per item keeps the mouse geometry exact, and the detail is only
        // missed by the arrow keys, which land you on that row anyway.
        const desc = cursor && r.kind === 'entry' && r.entry?.description ? `  ${r.entry.description}` : ''
        const text = `${cursor ? '❯ ' : '  '}${i + 1}. ${label}${desc}`
        return (
          <Box key={r.kind === 'entry' ? r.entry?.name : r.action} width={width}>
            <Text color={cursor ? colors.accentBright : dim ? colors.dim : colors.text} bold={cursor} wrap="truncate">
              {truncateToWidth(text, inner)}
            </Text>
          </Box>
        )
      })}
      {step === 'actions' && confirm && pickedEntry && (
        <Text color={colors.warning} wrap="truncate">
          {truncateToWidth(t('entry.confirmRemove', { name: pickedEntry.name }), inner)}
        </Text>
      )}
      <Text> </Text>
      <Text color={colors.dim} wrap="truncate">{truncateToWidth(step === 'list' ? t('entry.listFooter') : step === 'actions' ? t('entry.actionsFooter') : t('entry.detailsFooter'), inner)}</Text>
    </Box>
  )
}

// The label for an action row. "Clear the default" only appears on the entry
// that currently holds it, so the default row never reads as a no-op.
function actionLabel(action: Action, t: ReturnType<typeof useT>): string {
  if (action === 'setDefault') return t('entry.actDefault')
  if (action === 'clearDefault') return t('entry.actDefaultClear')
  if (action === 'details') return t('entry.actDetails')
  return t('entry.actRemove')
}