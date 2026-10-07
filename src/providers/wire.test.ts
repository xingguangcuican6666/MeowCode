import { describe, it, expect } from 'vitest'
import { parseStream } from './wire'

// Build a Response whose body is an SSE stream of the given events.
function sse(events: Array<Record<string, unknown>>): Response {
  const text = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() },
  })
  return new Response(body, { status: 200 })
}

async function drain(res: Response): Promise<{ text: string; done: any }> {
  let text = ''
  let done: any
  for await (const ev of parseStream(res)) {
    if (ev.type === 'text') text += ev.text
    else if (ev.type === 'done') done = ev
  }
  return { text, done }
}

const START = { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } }

describe('parseStream', () => {
  it('collects text and the stop reason', async () => {
    const { text, done } = await drain(sse([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    ]))
    expect(text).toBe('hello world')
    expect(done.stopReason).toBe('end_turn')
    expect(done.badToolInputs).toEqual([])
    expect(done.usage.output).toBe(4)
  })

  it('parses a complete tool_use argument', async () => {
    const { done } = await drain(sse([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'bash' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"ls -la"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]))
    expect(done.blocks[0]).toMatchObject({ type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls -la' } })
    expect(done.badToolInputs).toEqual([])
  })

  it('flags a tool_use whose JSON was cut off at max_tokens', async () => {
    const { done } = await drain(sse([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_2', name: 'write_file' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts","content":"half of th' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    ]))
    expect(done.stopReason).toBe('max_tokens')
    expect(done.badToolInputs).toEqual(['tu_2'])
    // The block still exists (it goes back to the API as history) but with no args.
    expect(done.blocks[0].input).toEqual({})
  })

  it('throws on a mid-stream error event instead of hanging', async () => {
    const res = sse([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ])
    await expect(drain(res)).rejects.toThrow(/overloaded_error: Overloaded/)
  })
})
