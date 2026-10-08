import { describe, it, expect } from 'vitest'
import { toolSchemas, resolveToolName, toolFilter } from './index'

const names = (opts?: { allowed?: string[]; orchestration?: boolean }): string[] =>
  toolSchemas(opts?.orchestration ?? true, true, undefined, false, opts?.allowed).map((t) => t.name)

describe('resolveToolName', () => {
  it("maps Claude Code's spellings onto ours", () => {
    expect(resolveToolName('Read')).toBe('read_file')
    expect(resolveToolName('Edit')).toBe('edit_file')
    expect(resolveToolName('MultiEdit')).toBe('edit_file')
    expect(resolveToolName('Write')).toBe('write_file')
    expect(resolveToolName('Bash')).toBe('bash')
    expect(resolveToolName('WebFetch')).toBe('web_fetch')
  })

  it('passes our own names and MCP names through', () => {
    expect(resolveToolName('read_file')).toBe('read_file')
    expect(resolveToolName('mcp__github__create_pr')).toBe('mcp__github__create_pr')
  })

  it('returns undefined for an unknown token', () => {
    expect(resolveToolName('definitely_not_a_tool')).toBeUndefined()
  })
})

describe('toolFilter', () => {
  it('an absent or empty list permits everything', () => {
    expect(toolFilter(undefined)('bash')).toBe(true)
    expect(toolFilter([])('bash')).toBe(true)
    expect(toolFilter(['*'])('bash')).toBe(true)
  })

  it('restricts to the listed tools, accepting either spelling', () => {
    const permit = toolFilter(['Read', 'grep'])
    expect(permit('read_file')).toBe(true)
    expect(permit('grep')).toBe(true)
    expect(permit('bash')).toBe(false)
    expect(permit('write_file')).toBe(false)
  })

  it('supports mcp globs', () => {
    const permit = toolFilter(['mcp__github__*'])
    expect(permit('mcp__github__create_pr')).toBe(true)
    expect(permit('mcp__slack__post')).toBe(false)
  })

  it('an unknown token narrows rather than widens', () => {
    const permit = toolFilter(['not_a_real_tool'])
    expect(permit('bash')).toBe(false)
    expect(permit('read_file')).toBe(false)
  })
})

describe('toolSchemas', () => {
  it('returns the full set by default', () => {
    const all = names()
    expect(all).toContain('bash')
    expect(all).toContain('write_file')
    expect(all).toContain('read_file')
  })

  it('restricts the schemas to an allow-list', () => {
    const limited = names({ allowed: ['read_file', 'grep', 'glob', 'list_dir'] })
    expect(limited.sort()).toEqual(['glob', 'grep', 'list_dir', 'read_file'])
    expect(limited).not.toContain('bash')
    expect(limited).not.toContain('write_file')
  })

  it('a read-only allow-list never leaks a mutating tool', () => {
    const readOnly = names({ allowed: ['read_file', 'grep', 'glob', 'list_dir', 'web_fetch', 'web_search', 'todo_write'] })
    for (const mutating of ['bash', 'write_file', 'edit_file', 'notebook_edit', 'monitor']) {
      expect(readOnly, mutating).not.toContain(mutating)
    }
  })

  it('still drops orchestration tools for a sub-agent', () => {
    const sub = names({ orchestration: false })
    expect(sub).not.toContain('task')
    expect(sub).not.toContain('workflow')
  })
})

describe('ask_user', () => {
  it('accepts a preview on the question and on an individual option', async () => {
    const { askUser } = await import('./ask')
    let seen: any
    const r = await askUser.run(
      {
        questions: [{
          question: 'Which audio stack?',
          header: 'Audio',
          preview: 'A. native\nB. wrapper',
          options: [
            { label: 'Web Audio API', description: 'no deps', preview: 'new AudioContext()' },
            { label: 'Howler.js' },
            { label: 'Tone.js' },
          ],
        }],
      },
      { requestUserInput: async (req: { questions: unknown[] }) => { seen = req; return { answers: [['Howler.js']] } } } as never,
    )
    expect(r.isError).toBeFalsy()
    const q = seen.questions[0] as { preview?: string; options: Array<{ preview?: string }> }
    expect(q.preview).toBe('A. native\nB. wrapper')
    expect(q.options[0].preview).toBe('new AudioContext()')
    expect(q.options[1].preview).toBeUndefined()
    // The schema advertises both levels so the model actually uses them.
    const props = (askUser.input_schema as any).properties.questions.items.properties
    expect(Object.keys(props)).toContain('preview')
    expect(Object.keys(props.options.items.properties)).toContain('preview')
  })

  it('reports the missing interactive user instead of hanging', async () => {
    const { askUser } = await import('./ask')
    const r = await askUser.run({ questions: [{ question: 'q?', header: 'h', options: [{ label: 'a' }, { label: 'b' }] }] }, {} as never)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('No interactive user')
  })
})
