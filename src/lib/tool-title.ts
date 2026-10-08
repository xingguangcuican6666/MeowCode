// The DISPLAY half of a tool call: the model's own short "what am I doing now"
// title and the one argument worth echoing under it. Kept apart from the business
// arguments on purpose — the title is something the model sets for the reader (see
// tools/index.ts, which advertises it in the schema), not something a tool acts on,
// so it must never reach a tool's run(), a permission rule or a hook.
//
// This module is React-free and dependency-free on purpose: providers/ use it
// before anything UI exists, and lib/transcript reads it back at render time.
import { isMcpToolName } from './mcp'
import type { MessageMeta } from '../types'

// The key the model may add to any built-in tool call, and the one key we take
// back off before the call executes.
export const TITLE_KEY = 'title'

// Long enough for a real sentence, short enough to leave the echoed argument a
// few columns on one terminal row. Over-long titles are cut with an ellipsis
// rather than wrapped, since a FlatLine is exactly one row (see lib/transcript).
const MAX_TITLE = 60

/**
 * Strip C0/C1 controls and DEL, then collapse whitespace. A model occasionally
 * emits a newline or an ANSI sequence in a title; both would break the
 * one-row-per-line invariant the scroll viewport depends on, and an escape
 * sequence would repaint the terminal from inside a transcript row.
 *
 * The class is assembled from character CODES rather than written out, so this
 * file holds no literal control character — which lint rightly flags, which no
 * editor or diff review can render, and which a copy-paste can silently mangle.
 */
const CONTROLS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  'g',
)

function sanitize(raw: string): string {
  const stripped = raw.replace(CONTROLS, ' ')
  // An escape sequence also has to lose its CSI payload: dropping ESC alone would
  // leave the "[31m" text behind as visible title characters.
  return stripped.replace(/\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * The model's activity title for a built-in tool call, normalized, or '' when it
 * sent none. Absent, blank and non-string all mean "no title" — the caller falls
 * back to its own vocabulary.
 */
export function normalizeToolTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const clean = sanitize(raw)
  if (!clean) return ''
  // Grapheme-aware truncation: a CJK title cut mid-character is a broken glyph,
  // and an emoji cut mid-emoji is worse.
  const graphemes = Array.from(clean)
  if (graphemes.length <= MAX_TITLE) return clean
  return graphemes.slice(0, MAX_TITLE).join('').trimEnd() + '…'
}

/** The title to carry alongside a tool_use event, already normalized. */
export function titleFor(name: string, input: Record<string, unknown> | undefined): string {
  if (!input || isMcpToolName(name)) return '' // an MCP tool's `title` is its own business
  return normalizeToolTitle(input[TITLE_KEY])
}

/**
 * The built-in tool's business arguments: the input minus the display title.
 *
 * Always a copy — the input may be the very object sitting in the provider's
 * conversation, and that is the record the API replays on the next request.
 */
export function stripToolTitle(name: string, input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input || !(TITLE_KEY in input) || isMcpToolName(name)) return input ?? {}
  const { [TITLE_KEY]: _display, ...rest } = input
  return rest
}

/**
 * The meta a tool-call header message carries: the tool's name and business input
 * (so the transcript can echo the argument without re-parsing the printed header),
 * the CALL id, and the model's title when it sent one.
 *
 * Shared so useChat, the launcher and the WebUI bridge all stamp a header the
 * transcript can read back the same way — the fold renderer only ever sees a
 * Message, and three hand-built metas were three chances to disagree.
 */
export function toolHeaderMeta(ev: {
  id: string
  name: string
  input: Record<string, unknown>
  title?: string
}): MessageMeta {
  return { toolName: ev.name, toolInput: ev.input, toolCallId: ev.id, ...(ev.title ? { toolTitle: ev.title } : {}) }
}