// A headless Ink harness for tests: render a tree into a FAKE stdout and read
// back the exact frames Ink writes. No terminal, no TTY, no focus stealing.
//
// Ink drives `useInput` off `stdin`'s 'readable' event + `stdin.read()`, so the
// fake stdin buffers whatever the test types and hands it back from read() —
// emitting 'data' does NOT reach useInput.
import { EventEmitter } from 'node:events'
import { render } from 'ink'

export interface InkHarness {
  /** Type bytes into the fake stdin, as a terminal would deliver them. */
  type: (s: string) => void
  /** Let Ink's throttled render flush, then return its frame as rows. */
  frame: (settleMs?: number) => Promise<string[]>
  /** Every write Ink made, in order (each one is a full screen update). */
  writes: string[]
  unmount: () => void
}

// Strip SGR / private-mode sequences so frame rows read as plain text.
const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

export function renderToFrames(
  element: React.ReactElement,
  { cols = 80, rows = 24 }: { cols?: number; rows?: number } = {},
): InkHarness {
  const writes: string[] = []
  const stdout: any = new EventEmitter()
  stdout.columns = cols
  stdout.rows = rows
  stdout.isTTY = true
  stdout.write = (s: string): boolean => { writes.push(s); return true }

  const stdin: any = new EventEmitter()
  stdin.isTTY = true
  const queue: Array<string | Buffer> = []
  let encoding: BufferEncoding | undefined
  stdin.setRawMode = (): void => {}
  stdin.setEncoding = (e: BufferEncoding): void => { encoding = e }
  stdin.ref = (): void => {}
  stdin.unref = (): void => {}
  stdin.read = (): string | Buffer | null => (queue.length ? queue.shift()! : null)
  stdin.type = (s: string): void => {
    queue.push(encoding === 'utf8' ? Buffer.from(s, 'utf8') : s)
    stdin.readable = true
    stdin.emit('readable')
  }

  const inst = render(element, { stdout, stdin, patchConsole: false, exitOnCtrlC: false })
  // Ink's log-update opens with a bare cursor-hide write; the frames we want all
  // carry inkable text, so pick the last such write.
  const rowsOf = (): string[] => {
    const withText = writes.filter((w) => /[A-Za-z一-鿿]/.test(strip(w)))
    return strip(withText[withText.length - 1] ?? '').split('\n')
  }
  return {
    writes,
    type: (s) => { (stdin as any).type(s) },
    frame: async (settleMs = 120) => {
      await new Promise((r) => setTimeout(r, settleMs))
      return rowsOf()
    },
    unmount: () => inst.unmount(),
  }
}
