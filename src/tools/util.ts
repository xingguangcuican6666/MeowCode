// Small shared helpers for the tool implementations. Kept in their own module so
// both the basic file/shell/search tools (fs-tools) and the orchestration tools
// (orchestration) can use them without importing each other.

export const MAX_OUT = 30000 // hard cap on any single tool's returned text

/** Truncate a tool's returned text to MAX_OUT, appending a note when clipped. */
export function clip(s: string, max = MAX_OUT): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n… [truncated ${s.length - max} chars]`
}

/**
 * Like `clip`, but keeps the start AND the end: build/test output puts the failure
 * at the bottom, so cutting only the tail would throw away exactly the useful part.
 */
export function clipMiddle(s: string, max = MAX_OUT): string {
  if (s.length <= max) return s
  const head = Math.floor(max * 0.6)
  const tail = max - head
  return `${s.slice(0, head)}\n… [${s.length - max} chars truncated] …\n${s.slice(-tail)}`
}
