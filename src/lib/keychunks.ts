// Reading a whole terminal chunk, key by key — because Ink's own answer is wrong
// for anything that arrives in one read.
//
// ink/build/hooks/use-input.js runs `parseKeypress(data)` over the ENTIRE chunk
// stdin's read callback handed it, and parseKeypress reports exactly ONE keypress.
// Measured against ink 5.1.1: "2\r" arrives as name="" / input="2\r" (so
// `key.return` is false), "\x1b[B\r" as name="down" / input="" (so the trailing ↵
// is swallowed), "\x1b" alone as name="escape". Any picker leaning on
// `key.upArrow` / `key.return` therefore loses every keystroke after the first
// when a fast typist or a held arrow key batches them — the classic "down arrow
// does nothing, then Enter picks the wrong row".
//
// decodeChunk walks the chunk instead, giving each key its own verdict. It is
// deliberately dumb: it classifies (escape / up / down / page-up / page-down /
// backspace / return / character / mouse-report) and hands each to the caller's
// handler. Callers do the moving and the choosing, which is where their own
// cursor state lives.

export interface ChunkKeys {
  /** A lone ESC — the user pressed Escape, not the introducer of a sequence. */
  onEscape?: () => void
  /** ↑ / k, including Shift-Tab's sibling sequences where they exist. */
  onUp?: () => void
  /** ↓ */
  onDown?: () => void
  /** PageUp — "a screen up", not one row. */
  onPageUp?: () => void
  /** PageDown */
  onPageDown?: () => void
  /** Backspace (DEL, and the CSI form some terminals send). */
  onBackspace?: () => void
  /** Enter / Return. */
  onReturn?: () => void
  /** Any other printable character, one call per character. */
  onChar?: (ch: string) => void
}

/** SGR (1006) mouse report: ESC [ < b ; x ; y (M|m). */
const SGR_MOUSE = /\x1b\[<\d+;\d+;\d+[Mm]/
/** Legacy X10 mouse report: ESC [ M b x y. */
const X10_MOUSE = /\x1b\[M[\s\S]{3}/
// A mouse report split across two reads is a real hazard (?1002 streams every
// motion event, and a chunk boundary can fall mid-report). Mouse listeners
// should also watch for these in the raw `data` event; decodeChunk just makes
// sure a report never reaches the key handlers as stray characters.
export function isMouseReport(input: string): boolean {
  return SGR_MOUSE.test(input) || X10_MOUSE.test(input)
}

// CSI / SS3 sequences we act on: ESC [ A / ESC [ B (arrows), ESC O A / ESC O B
// (application cursor mode — i.e. the arrow keys after the terminal has been put
// in DECCKM), and the `~`-terminated page keys ESC [ 5~ / ESC [ 6~. Anything else
// (Home, End, Delete, F-keys) is consumed and reported as nothing: it means
// nothing to a picker, and passing its bytes on as characters would be wrong.
const SEQ = /^[[\]O]?([\d;]*)([A-Za-z~])/

// Decode one read chunk. Returns after the first key that ends the interaction
// (Enter, Escape) only if that is what the chunk ends with — everything else is
// processed in order, so a chunk of "2\r" both moves the cursor to row 2 and
// confirms it, the way a person who typed that meant it.
export function decodeChunk(input: string, keys: ChunkKeys): void {
  if (!input) return
  // A mouse report is never a keystroke. Matched on the whole chunk first: a
  // report that happens to share a chunk with a real key must not lose it, so we
  // only bail when the chunk is nothing but a report.
  if (isMouseReport(input)) return
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '\x1b') {
      // Only a chunk that is *nothing but* ESC means "Escape pressed" — an ESC
      // that opens a CSI/SS3 sequence is that sequence's introducer.
      if (input.length === 1) { keys.onEscape?.(); return }
      const seq = input.slice(i + 1).match(SEQ)
      if (!seq) { keys.onEscape?.(); return } // ESC + something that isn't a sequence
      const param = Number(seq[1].split(';')[0])
      if (seq[2] === 'A') keys.onUp?.()
      else if (seq[2] === 'B') keys.onDown?.()
      else if (seq[2] === '~' && param === 1) keys.onUp?.()
      else if (seq[2] === '~' && param === 4) keys.onDown?.()
      else if (seq[2] === '~' && param === 5) keys.onPageUp?.()
      else if (seq[2] === '~' && param === 6) keys.onPageDown?.()
      else if (seq[2] === '~' && param === 7) keys.onBackspace?.() // Home on macOS
      else if (seq[2] === '~' && param === 8) keys.onBackspace?.() // End on macOS
      i += seq[0].length // step over the sequence, not the rest of the chunk
      continue
    }
    if (ch === '\r' || ch === '\n') { keys.onReturn?.(); continue }
    // DEL (0x7f) is what most terminals send for Backspace; 0x08 is the literal
    // ^H some do instead.
    if (ch === '\x7f' || ch === '\b') { keys.onBackspace?.(); continue }
    if (ch === '\t') continue // never let Tab indent a picker or re-trigger focus
    if (ch < ' ') continue // other C0 controls: ignore
    keys.onChar?.(ch)
  }
}