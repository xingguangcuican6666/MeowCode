import { describe, it, expect } from 'vitest'
import { decodeChunk, isMouseReport, type ChunkKeys } from './keychunks'
import { decodeInput, type KeyInfo } from './inkinput'

// Record every handler call in order, so a test can assert the exact sequence a
// chunk produces — which is the whole point: Ink's own parser collapses a chunk
// into ONE keypress, and this is the replacement.
function record(): { keys: ChunkKeys; calls: string[] } {
  const calls: string[] = []
  const keys: ChunkKeys = {
    onEscape: () => calls.push('esc'),
    onUp: () => calls.push('up'),
    onDown: () => calls.push('down'),
    onPageUp: () => calls.push('pgup'),
    onPageDown: () => calls.push('pgdn'),
    onBackspace: () => calls.push('bs'),
    onReturn: () => calls.push('ret'),
    onChar: (ch) => calls.push(`c:${ch}`),
  }
  return { keys, calls }
}

function decode(input: string): string[] {
  const { keys, calls } = record()
  decodeChunk(input, keys)
  return calls
}

describe('decodeChunk — the batched-keystroke bug', () => {
  // These three are the measured shapes from ink 5.1.1: parseKeypress reports ONE
  // keypress per chunk, so `key.return` is false for "2\r" and the ⏎ of
  // "\x1b[B\r" is swallowed entirely. Every picker leaning on `key` loses keys.
  it('handles "2\\r" as select-then-confirm', () => {
    expect(decode('2\r')).toEqual(['c:2', 'ret'])
  })

  it('handles "\\x1b[B\\r" as down-then-confirm', () => {
    expect(decode('\x1b[B\r')).toEqual(['down', 'ret'])
  })

  it('reports a lone ESC as escape, not as a sequence introducer', () => {
    expect(decode('\x1b')).toEqual(['esc'])
  })

  it('does not read an ESC that opens a sequence as an escape keypress', () => {
    expect(decode('\x1b[A')).toEqual(['up'])
    expect(decode('\x1b[B')).toEqual(['down'])
    // SS3, i.e. the arrows after the terminal is in application cursor mode.
    expect(decode('\x1bOA')).toEqual(['up'])
    expect(decode('\x1bOB')).toEqual(['down'])
  })

  it('walks a longer batch in order', () => {
    expect(decode('\x1b[B\x1b[B\x1b[A\r')).toEqual(['down', 'down', 'up', 'ret'])
    expect(decode('abc')).toEqual(['c:a', 'c:b', 'c:c'])
  })

  it('treats an ESC followed by a non-sequence as escape', () => {
    expect(decode('\x1b\x7f')).toEqual(['esc'])
  })
})

describe('decodeChunk — page keys, backspace, return', () => {
  it('maps the ~-terminated page keys', () => {
    expect(decode('\x1b[5~')).toEqual(['pgup'])
    expect(decode('\x1b[6~')).toEqual(['pgdn'])
    expect(decode('\x1b[1~')).toEqual(['up'])
    expect(decode('\x1b[4~')).toEqual(['down'])
  })

  it('consumes other ~ sequences without reporting them as keys', () => {
    // Home/End/Delete mean nothing to a picker; passing their bytes on as
    // characters would be worse than dropping them.
    expect(decode('\x1b[H')).toEqual([])
    expect(decode('\x1b[F')).toEqual([])
    expect(decode('\x1b[3~')).toEqual([])
  })

  it('reports both backspace byte forms', () => {
    expect(decode('\x7f')).toEqual(['bs'])
    expect(decode('\b')).toEqual(['bs'])
  })

  it('reports both return byte forms, and both independently', () => {
    expect(decode('\r')).toEqual(['ret'])
    expect(decode('\n')).toEqual(['ret'])
    expect(decode('\r\n')).toEqual(['ret', 'ret'])
  })

  it('keeps CJK and emoji as single characters', () => {
    // The chunk is already-decoded UTF-8 (cli.tsx uses a StringDecoder for the
    // stdin stream), so a code point is one array element here — iterate by
    // index, never by UTF-16 unit.
    expect(decode('喵')).toEqual(['c:喵'])
  })

  it('ignores Tab and other control bytes', () => {
    expect(decode('\t')).toEqual([])
    expect(decode('\x01')).toEqual([])
  })

  it('does nothing on an empty chunk', () => {
    expect(decode('')).toEqual([])
  })

  it('survives a chunk with only some handlers', () => {
    expect(() => decodeChunk('\x1b[Bx\r', {})).not.toThrow()
  })
})

// Reproduce Ink's own shaping, so the decodeInput tests are grounded in measured
// shapes rather than guesses. Mirrors ink 5.1.1 measured against
// parse-keypress.js + use-input.js:64-75:
//
//   "\x1b[A" -> name "up",      input ""       (use-input blanks a named key)
//   "\r"     -> name "return",  input "\r"     ("return" is not in keyName)
//   "\x7f"   -> name "delete",  input ""       (not "backspace"!)
//   "2\r"    -> name "",        input "2\r"
//   "\x1b[B\r"-> name "down",   input ""
const NAMED = new Set(['up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'delete'])

/** Ink's own parseKeypress, only as far as these shapes need it. A batch is named
 *  after its FIRST key (measured: "\x1b[B\r" -> name "down"), so the sequence
 *  regexes here are prefix-anchored, not end-anchored. */
function inkShapes(chunk: string): { input: string; name: string } {
  const csi = chunk.match(/^\x1b\[([0-9]*)([A-Z~])/)
  if (csi) {
    const n = csi[1]; const f = csi[2]
    if (f === 'A') return { input: chunk, name: 'up' }
    if (f === 'B') return { input: chunk, name: 'down' }
    if (f === 'C') return { input: chunk, name: 'right' }
    if (f === 'D') return { input: chunk, name: 'left' }
    if (f === 'H') return { input: chunk, name: 'home' }
    if (f === 'F') return { input: chunk, name: 'end' }
    if (f === '~' && n === '5') return { input: chunk, name: 'pageup' }
    if (f === '~' && n === '6') return { input: chunk, name: 'pagedown' }
    if (f === '~' && n === '3') return { input: chunk, name: 'delete' }
  }
  const ss3 = chunk.match(/^\x1bO([AB])/)
  if (ss3) return { input: chunk, name: ss3[1] === 'A' ? 'up' : 'down' }
  if (chunk === '\x1b') return { input: chunk, name: 'escape' }
  if (chunk === '\r') return { input: chunk, name: 'return' }
  if (chunk === '\n') return { input: chunk, name: 'enter' }
  if (chunk === '\x7f' || chunk === '\b') return { input: chunk, name: 'delete' }
  if (chunk === '\t') return { input: chunk, name: 'tab' }
  return { input: chunk, name: '' }
}

/** What useInput actually calls back with for a given read chunk. */
function inkArg(chunk: string): KeyInfo {
  const { input: seq, name } = inkShapes(chunk)
  let input = seq
  if (NAMED.has(name) || name === 'escape' || name === 'backspace') input = ''
  if (input.startsWith('\x1b')) input = input.slice(1)
  return {
    input,
    key: {
      upArrow: name === 'up', downArrow: name === 'down',
      pageUp: name === 'pageup', pageDown: name === 'pagedown',
      return: name === 'return', escape: name === 'escape',
      backspace: name === 'backspace', delete: name === 'delete',
    },
  }
}

function decodeSrc(chunk: string): string[] {
  const { keys, calls } = record()
  decodeInput(inkArg(chunk), keys)
  return calls
}

describe('isMouseReport', () => {
  it('recognizes SGR press and release reports', () => {
    expect(isMouseReport('\x1b[<0;10;4M')).toBe(true)
    expect(isMouseReport('\x1b[<0;10;4m')).toBe(true)
    expect(isMouseReport('\x1b[<64;1;4M')).toBe(true) // wheel
  })

  it('recognizes the legacy X10 form', () => {
    expect(isMouseReport('\x1b[M !!')).toBe(true)
  })

  it('does not mistake a cursor key for a mouse report', () => {
    expect(isMouseReport('\x1b[B')).toBe(false)
    expect(isMouseReport('2')).toBe(false)
  })

  it('keeps a report from ever reaching the key handlers', () => {
    // ?1002 streams a report per motion event; if one arrived as text, its bytes
    // must not be typed into the draft.
    expect(decode('\x1b[<0;10;4M')).toEqual([])
  })
})

describe('decodeInput — the half decodeChunk alone cannot see', () => {
  it('reports a plain arrow, which Ink hands over as input=""', () => {
    expect(inkArg('\x1b[A').input).toBe('')
    expect(decodeSrc('\x1b[A')).toEqual(['up'])
    expect(decodeSrc('\x1b[B')).toEqual(['down'])
  })

  it('reports a plain page key, Enter, Escape and Backspace', () => {
    expect(decodeSrc('\x1b[5~')).toEqual(['pgup'])
    expect(decodeSrc('\x1b[6~')).toEqual(['pgdn'])
    expect(decodeSrc('\r')).toEqual(['ret'])
    expect(decodeSrc('\x1b')).toEqual(['esc'])
    expect(decodeSrc('\x7f')).toEqual(['bs'])
  })

  it('takes a batched sequence from the flag, since Ink discards the rest of it', () => {
    // Measured: parseKeypress names the FIRST key of the chunk, then use-input
    // blanks `input` — so for "\x1b[B\r" the trailing Enter is gone before the
    // callback ever runs and no decoder can recover it. decodeInput must at
    // least not drop the ↓ (what decodeChunk('') alone does), and must not
    // invent a second one from the flag either. That matches every other picker
    // here; the Enter arrives with the next read.
    expect(inkArg('\x1b[B\r').key.downArrow).toBe(true)
    expect(inkArg('\x1b[B\r').input).toBe('')
    expect(decodeSrc('\x1b[B\r')).toEqual(['down'])
  })

  it('does NOT double-count "2\\r", whose bytes Ink does hand over', () => {
    // name "" here, so `input` survives intact and decodeChunk walks it: the
    // Enter is real here, and the flag path must stay out of the way.
    expect(inkArg('2\r').key.return).toBe(false)
    expect(decodeSrc('2\r')).toEqual(['c:2', 'ret'])
  })

  it('still types printable chunks', () => {
    expect(decodeSrc('meow')).toEqual(['c:m', 'c:e', 'c:o', 'c:w'])
    expect(decodeSrc('喵')).toEqual(['c:喵'])
  })
})