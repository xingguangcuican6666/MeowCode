// The one line a picker should pass to `useInput`:
//
//   useInput((input, key) => decodeInput({ input, key }, { onUp, onDown, … }))
//
// because neither of Ink's two arguments is enough on its own, and each one fails
// in the opposite direction. Both halves are measured against ink 5.1.1:
//
//   chunk      name      input      what a picker leaning on `key` does
//   "\x1b[B"   "down"    ""         works
//   "\x1b[B\r" "down"    ""         the trailing ⏎ is swallowed
//   "2\r"      ""        "2\r"      key.return is false, so ⏎ is lost
//   "\x1b[A"   "up"      ""         works
//
// `key` alone: parseKeypress reports exactly ONE keypress per read, so every key
// after the first in a chunk is silently dropped (use-input.js:46,68).
//
// `input` alone: use-input.js:68 blanks `input` for any key whose name it
// recognizes — nonAlphanumericKeys is every keyName value plus 'backspace', i.e.
// up/down/pageup/pagedown/home/end/delete/escape. The bytes of a plain arrow
// never reach the callback; only the flag does.
//
// So: walk the chunk, and consult the flags only when the chunk had no
// characters. Never both — for a batch Ink still sets the flags from the FIRST
// keypress it parsed, so "\x1b[B\r" arrives as key.downArrow === true with
// input === '', and re-deriving that from the flag would double-count the ↓.
//
// What no decoder can do is recover a batch's keys after the first: Ink discards
// them, and useInput never sees the bytes. "\x1b[B\r" therefore acts as ↓ alone
// and its Enter arrives as the next read. For a chunk Ink names "" — a fast
// "2⏎", the common case — nothing is lost and the whole chunk acts at once.

import { decodeChunk, type ChunkKeys } from './keychunks'

/** What Ink's useInput hands the callback — a structural subset of its `Key`. */
export interface KeyInfo {
  input: string
  key: {
    upArrow: boolean
    downArrow: boolean
    pageUp: boolean
    pageDown: boolean
    return: boolean
    escape: boolean
    backspace: boolean
    delete: boolean
  }
}

export function decodeInput(src: KeyInfo, keys: ChunkKeys): void {
  decodeChunk(src.input, keys)
  if (src.input) return
  if (src.key.upArrow) keys.onUp?.()
  else if (src.key.downArrow) keys.onDown?.()
  else if (src.key.pageUp) keys.onPageUp?.()
  else if (src.key.pageDown) keys.onPageDown?.()
  else if (src.key.return) keys.onReturn?.()
  else if (src.key.escape) keys.onEscape?.()
  // Backspace OR delete: Ink reports the ordinary 0x7f as `key.delete`
  // (measured), and in a picker both mean "erase one character".
  else if (src.key.backspace || src.key.delete) keys.onBackspace?.()
}