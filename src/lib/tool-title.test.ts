import { describe, it, expect } from 'vitest'
import { normalizeToolTitle, stripToolTitle, titleFor, TITLE_KEY } from './tool-title'
import { toolSchemas, runTool } from '../tools'
import { TOOLS } from '../tools/impl'

// The model's activity title is DISPLAY metadata we asked for in the schema, not
// a tool argument. Two things have to hold at once: the model must be able to send
// it (so it appears in the schema), and nothing downstream may ever see it — not
// the tool, not a permission rule, not the conversation the API replays.

describe('normalizeToolTitle', () => {
  it('keeps a normal title as-is', () => {
    expect(normalizeToolTitle('Reading the auth gate')).toBe('Reading the auth gate')
  })

  it('treats absent, blank and non-string as "no title"', () => {
    // A model that sends "" or a number has not titled anything, and the caller
    // falls back to its own vocabulary — never to a garbled label.
    for (const raw of [undefined, null, '', '   ', 42, true, {}, []]) {
      expect(normalizeToolTitle(raw)).toBe('')
    }
  })

  it('flattens newlines and tabs so a row can never span two lines', () => {
    // The scroll viewport's whole windowing math assumes one FlatLine is one
    // terminal row (see lib/transcript); a newline here would desynchronize it.
    expect(normalizeToolTitle('Reading\nsrc/app.tsx')).toBe('Reading src/app.tsx')
    expect(normalizeToolTitle('Reading\tsrc/app.tsx')).toBe('Reading src/app.tsx')
    expect(normalizeToolTitle('a\r\nb')).toBe('a b')
  })

  it('strips ANSI escapes rather than letting them repaint the terminal', () => {
    const title = normalizeToolTitle('\u001b[31mReading\u001b[0m the auth gate')
    expect(title).toBe('Reading the auth gate')
    expect(title).not.toContain('\u001b')
  })

  it('caps an over-long title with an ellipsis', () => {
    const long = normalizeToolTitle('x'.repeat(200))
    expect(long.length).toBeLessThanOrEqual(61)
    expect(long.endsWith('…')).toBe(true)
  })

  it('counts CJK titles per character, so none is cut in half', () => {
    const long = normalizeToolTitle('读'.repeat(200))
    expect(long).toBe('读'.repeat(60) + '…')
  })
})

describe('titleFor / stripToolTitle', () => {
  it('reads a built-in tool title and hands back the business arguments', () => {
    const input = { path: 'src/app.tsx', [TITLE_KEY]: 'Reading app.tsx' }
    expect(titleFor('read_file', input)).toBe('Reading app.tsx')
    expect(stripToolTitle('read_file', input)).toEqual({ path: 'src/app.tsx' })
  })

  it('never mutates the input it was given', () => {
    // The caller may be holding the very object the API replays next request.
    const input = { path: 'src/app.tsx', title: 'Reading app.tsx' }
    stripToolTitle('read_file', input)
    expect(input).toEqual({ path: 'src/app.tsx', title: 'Reading app.tsx' })
  })

  it('leaves an MCP tool title alone — that field is the server’s own', () => {
    // lib/mcp forwards the whole input to a third-party server, so a `title` on an
    // MCP call is business data. Stripping it would silently break those tools.
    const input = { title: 'Create issue', body: 'x' }
    expect(titleFor('mcp__github__create_issue', input)).toBe('')
    expect(stripToolTitle('mcp__github__create_issue', input)).toBe(input)
  })

  it('passes through an input with no title at all', () => {
    const input = { path: 'src/app.tsx' }
    expect(titleFor('read_file', input)).toBe('')
    expect(stripToolTitle('read_file', input)).toBe(input)
  })
})

describe('the title in the schema', () => {
  const builtin = toolSchemas().filter((t) => !t.name.startsWith('mcp__'))

  it('advertises an optional string title on every built-in tool', () => {
    for (const t of builtin) {
      const props = (t.input_schema as { properties?: Record<string, any> }).properties
      expect(props?.[TITLE_KEY]?.type, t.name).toBe('string')
      // Optional: the model may send one, and must not be forced to.
      expect((t.input_schema as { required?: string[] }).required ?? []).not.toContain(TITLE_KEY)
    }
  })

  it('does not mutate the tool’s own schema object', () => {
    // TOOLS holds one schema per definition, shared by every caller; injecting
    // into it in place would make the schema depend on who asked last.
    const read = TOOLS.find((t) => t.name === 'read_file')!
    expect((read.input_schema as { properties?: Record<string, unknown> }).properties?.[TITLE_KEY]).toBeUndefined()
  })

  it('leaves the dynamic subagent_type enum working alongside the title', () => {
    const task = toolSchemas(true, true, '/tmp').find((t) => t.name === 'task')!
    const props = (task.input_schema as { properties: Record<string, any> }).properties
    expect(props[TITLE_KEY]).toBeTruthy()
    expect(Array.isArray(props.subagent_type.enum)).toBe(true)
  })
})

describe('runTool as the execution boundary', () => {
  it('strips the display title before a tool runs', async () => {
    // The HTTP /api/tools/call path and the mock provider both go through here,
    // so this is the one place that has to be right for every caller.
    const read = TOOLS.find((t) => t.name === 'read_file')!
    const seen: Record<string, unknown>[] = []
    const orig = read.run
    read.run = async (input) => { seen.push(input); return { content: 'ok' } }
    try {
      await runTool('read_file', { path: 'MEOWCODE.md', title: 'Reading the docs' }, {} as never)
    } finally { read.run = orig }
    expect(seen).toEqual([{ path: 'MEOWCODE.md' }])
  })
})