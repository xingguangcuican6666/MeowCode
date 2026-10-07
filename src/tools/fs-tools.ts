// The basic agent toolset: read/write/edit a file, run a shell command, search
// by content (grep) or by name (glob), list a directory. Node builtins only, plus
// ripgrep when the machine has it (grep falls back to GNU grep otherwise), so the
// loop works anywhere the CLI runs.
//
// Security notes that are easy to regress:
//   - Model-supplied values are NEVER interpolated into a shell string. The shell
//     runs only the `bash` tool's own `command`; grep/rg get an argv array.
//   - Everything that spawns goes through lib/shell (process-group kill, bounded
//     output, no stdin) — see the header there.
//   - write_file/edit_file enforce read-before-write (lib/readState).
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import type { ToolDef, ToolResult } from './types'
import type { DiffLine, ToolResultBlock } from '../types'
import { clip, clipMiddle } from './util'
import { recordCheckpoint } from '../lib/checkpoints'
import { startBgShell } from '../lib/bgshell'
import { runCaptured, runFile, hasBinary, type RunResult } from '../lib/shell'
import { expandBraces, globToRegExp, hasGlobChars } from '../lib/glob'
import { noteRead, noteFileState, staleReason } from '../lib/readState'

// Resolve a tool-supplied path: `~` expands to the home dir, relative paths are
// anchored at the session cwd.
function resolve(cwd: string, p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return path.isAbsolute(p) ? p : path.resolve(cwd, p)
}

// Line-level added/removed counts between two texts, for the Usage tab's "Total
// code changes". Uses an LCS (longest common subsequence) so unchanged lines
// aren't double-counted; falls back to a plain size delta on very large files to
// avoid the O(m×n) table blowing up.
function lineDiff(oldText: string, newText: string): { added: number; removed: number } {
  const a = oldText === '' ? [] : oldText.split('\n')
  const b = newText === '' ? [] : newText.split('\n')
  const m = a.length, n = b.length
  if (m === 0) return { added: n, removed: 0 }
  if (n === 0) return { added: 0, removed: m }
  if (m * n > 4_000_000) return { added: Math.max(0, n - m), removed: Math.max(0, m - n) }
  let prev = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0)
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    prev = cur
  }
  const lcs = prev[n]
  return { added: n - lcs, removed: m - lcs }
}

// A unified diff (context + / - rows) between two texts, for the write/edit diff
// view. Full LCS backtrack → per-line ops, then unchanged runs longer than
// 2×context are collapsed to a "⋯ N unchanged lines" hunk marker. Guards: bails
// (returns []) when the O(m×n) table would be huge, and caps total emitted rows
// so a massive rewrite can't flood the transcript.
const DIFF_CONTEXT = 3
const DIFF_MAX_ROWS = 200
function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split('\n')
  const b = newText === '' ? [] : newText.split('\n')
  const m = a.length, n = b.length
  if (m === 0 && n === 0) return []
  if (m * n > 1_000_000) return [] // too big to diff line-by-line; skip the view
  // LCS table, then backtrack into an ordered op list.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  type Op = { tag: 'context' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }
  const ops: Op[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ tag: 'context', text: a[i], oldNo: i + 1, newNo: j + 1 }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ tag: 'del', text: a[i], oldNo: i + 1 }); i++ }
    else { ops.push({ tag: 'add', text: b[j], newNo: j + 1 }); j++ }
  }
  while (i < m) { ops.push({ tag: 'del', text: a[i], oldNo: i + 1 }); i++ }
  while (j < n) { ops.push({ tag: 'add', text: b[j], newNo: j + 1 }); j++ }
  // Collapse long unchanged runs, keeping DIFF_CONTEXT lines around each change.
  const keep = new Array<boolean>(ops.length).fill(false)
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].tag === 'context') continue
    for (let d = -DIFF_CONTEXT; d <= DIFF_CONTEXT; d++) {
      const idx = k + d
      if (idx >= 0 && idx < ops.length) keep[idx] = true
    }
  }
  const out: DiffLine[] = []
  let skipped = 0
  const flushHunk = () => { if (skipped > 0) { out.push({ tag: 'hunk', text: `⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}` }); skipped = 0 } }
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) { skipped++; continue }
    flushHunk()
    out.push(ops[k])
    if (out.length >= DIFF_MAX_ROWS) { out.push({ tag: 'hunk', text: '⋯ diff truncated' }); return out }
  }
  flushHunk()
  return out
}

const MAX_BASH_TIMEOUT_MS = 600_000
const DEFAULT_BASH_TIMEOUT_MS = 120_000

const bash: ToolDef = {
  name: 'bash',
  description:
    'Run a shell command in the working directory and return its combined stdout/stderr. Use for builds, tests, git, and any CLI task. ' +
    'Each call starts a fresh shell in the working directory (a `cd` does not carry over to the next call), with stdin closed. ' +
    'Set `run_in_background: true` for a long-running command (dev server, watcher, long build): it returns a shell id immediately instead of blocking, and you read its output with the `bash_output` tool and stop it with `bash_output` action "kill".',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute.' },
      timeout_ms: { type: 'number', description: 'Optional timeout in milliseconds (default 120000, max 600000; foreground only). On timeout the command and all its child processes are killed.' },
      run_in_background: { type: 'boolean', description: 'Run detached in the background and return a shell id (poll output via bash_output). Default false.' },
    },
    required: ['command'],
  },
  run: async (input, ctx) => {
    const command = String(input.command ?? '')
    if (!command.trim()) return { content: 'bash: `command` is required', isError: true }
    if (input.run_in_background === true) {
      const ttl = typeof input.timeout_ms === 'number' && input.timeout_ms > 0 ? input.timeout_ms : undefined
      const { shell, error } = startBgShell(command, ctx.cwd, ttl)
      if (error || !shell) return { content: `bash (background): ${error ?? 'failed to start'}`, isError: true }
      return {
        content: `Started background shell ${shell.id}: ${command.split('\n')[0].slice(0, 80)}\nRead its output with bash_output (bash_id: "${shell.id}") and stop it with bash_output action "kill".`,
        display: `bash · background ${shell.id}`,
      }
    }
    const asked = Number(input.timeout_ms)
    const timeoutMs = Math.min(MAX_BASH_TIMEOUT_MS, asked > 0 ? asked : DEFAULT_BASH_TIMEOUT_MS)
    const r = await runCaptured(command, { cwd: ctx.cwd, timeoutMs, signal: ctx.signal })
    if (r.aborted) return { content: '(aborted)', isError: true }
    if (r.error) return { content: `failed to run: ${r.error}`, isError: true }
    const body = [r.stdout.trim(), r.stderr.trim() ? `[stderr]\n${r.stderr.trim()}` : ''].filter(Boolean).join('\n')
    const tag = r.timedOut
      ? `\n[timed out after ${Math.round(timeoutMs / 1000)}s — the command and its child processes were killed]`
      : r.code === 0 ? '' : r.signal ? `\n[killed by ${r.signal}]` : `\n[exit ${r.code}]`
    return { content: clipMiddle((body || '(no output)') + tag), isError: r.timedOut || r.code !== 0 }
  },
}

// Extension → Anthropic media type for the multimodal read path. Images come
// back as an `image` content block and PDFs as a `document` block, so the model
// sees the file directly instead of a base64 blob dumped as text. Anything not
// listed here is read as UTF-8 text (the default path in read_file).
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
const MAX_IMAGE_BYTES = 5 * 1024 * 1024   // Anthropic per-image cap (~5MB)
const MAX_PDF_BYTES = 20 * 1024 * 1024    // stay well under the ~32MB request cap
const WHOLE_FILE_BYTES = 2 * 1024 * 1024  // bigger text files are streamed, never slurped
const MAX_LINE_CHARS = 2000               // a single minified line can't eat the whole budget
const DEFAULT_READ_LINES = 2000

// A NUL byte in the first few KB is the classic "this is not text" test.
async function looksBinary(file: string, size: number): Promise<boolean> {
  if (size === 0) return false
  const fh = await fsp.open(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(8192, size))
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}

// Read lines [start, start+limit) of a big file without loading it: stream it
// and stop as soon as the window is full. `more` says whether anything follows.
async function readWindow(file: string, start: number, limit: number): Promise<{ lines: string[]; more: boolean }> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  const lines: string[] = []
  let n = 0
  let more = false
  try {
    for await (const line of rl) {
      n++
      if (n < start) continue
      if (lines.length >= limit) { more = true; break }
      lines.push(line)
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return { lines, more }
}

// Jupyter notebook → readable text with cell ids (what notebook_edit needs).
function renderNotebook(raw: string): string | null {
  let nb: { cells?: unknown[] }
  try { nb = JSON.parse(raw) } catch { return null }
  if (!nb || !Array.isArray(nb.cells)) return null
  const text = (s: unknown): string => (Array.isArray(s) ? s.join('') : typeof s === 'string' ? s : '')
  const out: string[] = [`Jupyter notebook · ${nb.cells.length} cell${nb.cells.length === 1 ? '' : 's'}`]
  nb.cells.forEach((cell, i) => {
    const c = (cell ?? {}) as Record<string, any>
    out.push('', `--- cell ${i + 1} · ${c.cell_type ?? '?'}${c.id ? ` · id: ${c.id}` : ''} ---`, text(c.source))
    if (Array.isArray(c.outputs)) {
      for (const o of c.outputs as Array<Record<string, any>>) {
        const t = text(o?.text) || text(o?.data?.['text/plain']) || (o?.ename ? `${o.ename}: ${o.evalue ?? ''}` : '')
        if (t) out.push('[output]', t.length > 2000 ? t.slice(0, 2000) + '… [output truncated]' : t)
        else if (o?.data && Object.keys(o.data).some((k) => k.startsWith('image/'))) out.push('[output: image omitted]')
      }
    }
  })
  return out.join('\n')
}

const readFile: ToolDef = {
  name: 'read_file',
  description: 'Read a file. Text files return with line numbers (offset/limit apply; very long lines are cut at 2000 characters); Jupyter notebooks (.ipynb) are rendered cell by cell with their ids; image files (PNG/JPEG/GIF/WebP) and PDFs are returned as content the model can view directly. Binary files are refused. Read a file before you edit or overwrite it.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (absolute or relative to the working directory).' },
      offset: { type: 'number', description: '1-based line to start from (text files only).' },
      limit: { type: 'number', description: 'Max lines to read (default 2000; text files only).' },
    },
    required: ['path'],
  },
  async run(input, ctx) {
    const file = resolve(ctx.cwd, String(input.path ?? ''))
    const ext = path.extname(file).toLowerCase()
    const imageType = IMAGE_TYPES[ext]
    const isPdf = ext === '.pdf'
    let stat: fs.Stats
    try {
      stat = await fsp.stat(file)
    } catch (e) {
      return { content: `cannot read ${file}: ${(e as Error).message}`, isError: true }
    }
    if (stat.isDirectory()) return { content: `${file} is a directory — use list_dir to see its entries.`, isError: true }
    // Multimodal path: hand images/PDFs to the model as viewable blocks.
    if (imageType || isPdf) {
      try {
        const cap = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
        if (stat.size > cap) {
          return { content: `${file} is too large to read as ${isPdf ? 'a PDF' : 'an image'} (${(stat.size / 1048576).toFixed(1)}MB > ${(cap / 1048576).toFixed(0)}MB cap).`, isError: true }
        }
        const data = (await fsp.readFile(file)).toString('base64')
        const kind = isPdf ? 'PDF' : 'image'
        const caption = `Read ${kind} ${file} (${(stat.size / 1024).toFixed(1)} KB).`
        const media: ToolResultBlock = isPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          : { type: 'image', source: { type: 'base64', media_type: imageType, data } }
        return { content: caption, display: `read_file · ${input.path} (${kind})`, blocks: [{ type: 'text', text: caption }, media] }
      } catch (e) {
        return { content: `cannot read ${file}: ${(e as Error).message}`, isError: true }
      }
    }
    try {
      if (await looksBinary(file, stat.size)) {
        return { content: `${file} looks like a binary file (${(stat.size / 1024).toFixed(1)} KB) — not printing it. Use bash (file, xxd, strings) if you really need to inspect it.`, isError: true }
      }
      const start = Math.max(1, Math.floor(Number(input.offset)) || 1)
      const limit = Math.min(10_000, Math.max(1, Math.floor(Number(input.limit)) || DEFAULT_READ_LINES))
      let lines: string[]
      let more = false
      if (stat.size <= WHOLE_FILE_BYTES) {
        let raw = await fsp.readFile(file, 'utf8')
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
        if (ext === '.ipynb') {
          const nb = renderNotebook(raw)
          if (nb) {
            noteRead(file, stat.mtimeMs)
            return { content: clip(nb), display: `read_file · ${input.path} (notebook)` }
          }
        }
        if (raw === '') {
          noteRead(file, stat.mtimeMs)
          return { content: '(empty file)' }
        }
        const all = raw.split('\n')
        if (all.length > 1 && all[all.length - 1] === '') all.pop() // no phantom line after the final newline
        lines = all.slice(start - 1, start - 1 + limit)
        more = start - 1 + limit < all.length
      } else {
        const win = await readWindow(file, start, limit)
        lines = win.lines
        more = win.more
      }
      noteRead(file, stat.mtimeMs)
      const numbered = lines
        .map((l, i) => {
          const s = l.endsWith('\r') ? l.slice(0, -1) : l
          return `${String(start + i).padStart(5)}\t${s.length > MAX_LINE_CHARS ? s.slice(0, MAX_LINE_CHARS) + '… [line truncated]' : s}`
        })
        .join('\n')
      const tail = more ? `\n… [the file continues after line ${start + lines.length - 1}; call read_file again with offset=${start + lines.length}]` : ''
      return { content: clip(numbered || '(no lines in that range)') + tail }
    } catch (e) {
      return { content: `cannot read ${file}: ${(e as Error).message}`, isError: true }
    }
  },
}

const writeFile: ToolDef = {
  name: 'write_file',
  description: 'Write (create or overwrite) a UTF-8 text file. Creates parent directories as needed. To overwrite an EXISTING file you must have read it first (read_file) and it must not have changed since; prefer edit_file for changes to existing files.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write.' },
      content: { type: 'string', description: 'Full file contents.' },
    },
    required: ['path', 'content'],
  },
  async run(input, ctx) {
    const file = resolve(ctx.cwd, String(input.path ?? ''))
    const content = String(input.content ?? '')
    try {
      const stale = staleReason(file)
      if (stale) return { content: `write_file: refusing to overwrite ${file} — ${stale}`, isError: true }
      // Read the prior contents (if any) so we can report an accurate line diff
      // rather than counting a full rewrite as all-added. `prior === null` means
      // the file didn't exist — a rewind then deletes it. A binary file can't be
      // snapshotted as text without corrupting it on restore, so it is skipped.
      const priorBuf = await fsp.readFile(file).catch(() => null)
      const binary = !!priorBuf && priorBuf.includes(0)
      const prior = priorBuf && !binary ? priorBuf.toString('utf8') : null
      if (ctx.rewind !== false && !binary) recordCheckpoint(file, prior, 'write_file', Date.now())
      const before = prior ?? ''
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(file, content, 'utf8')
      noteFileState(file)
      const { added, removed } = lineDiff(before, content)
      const diff = diffLines(before, content)
      return { content: `wrote ${file} (${content.length} bytes)`, linesAdded: added, linesRemoved: removed, diff: diff.length ? diff : undefined }
    } catch (e) {
      return { content: `cannot write ${file}: ${(e as Error).message}`, isError: true }
    }
  },
}
const editFile: ToolDef = {
  name: 'edit_file',
  description:
    'Replace exact text in a file you have already read (read_file). Single edit: pass old_string/new_string (old_string must be unique unless replace_all). ' +
    'Multiple edits at once: pass `edits`, an array of {old_string, new_string, replace_all?} applied IN ORDER and ATOMICALLY — every edit must match or nothing is written, so later edits see the result of earlier ones. Use `edits` to make several related changes to one file in a single call.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit.' },
      old_string: { type: 'string', description: 'Exact text to replace (single-edit form).' },
      new_string: { type: 'string', description: 'Replacement text (single-edit form).' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
      edits: {
        type: 'array',
        description: 'A sequence of edits applied atomically in order (multi-edit form). Overrides old_string/new_string when present.',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string', description: 'Exact text to replace.' },
            new_string: { type: 'string', description: 'Replacement text.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
          },
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['path'],
  },
  async run(input, ctx) {
    const file = resolve(ctx.cwd, String(input.path ?? ''))
    // Normalize to a list of edits so single- and multi-edit share one code path.
    const rawEdits = Array.isArray(input.edits) && input.edits.length
      ? (input.edits as unknown[])
      : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }]
    const edits = rawEdits.map((e) => {
      const o = (e ?? {}) as Record<string, unknown>
      return { oldStr: String(o.old_string ?? ''), newStr: String(o.new_string ?? ''), replaceAll: o.replace_all === true }
    })
    try {
      const stale = staleReason(file)
      if (stale) return { content: `edit_file: refusing to edit ${file} — ${stale}`, isError: true }
      const raw = await fsp.readFile(file, 'utf8')
      if (raw.includes('\0')) return { content: `edit_file: ${file} looks like a binary file; it cannot be edited as text.`, isError: true }
      // A CRLF file is shown to the model with its '\r's stripped, so a multi-line
      // old_string arrives with bare '\n'. Match (and write) in the file's own
      // line-ending style so such a file is editable and stays CRLF.
      const crlf = raw.includes('\r\n')
      const fit = (s: string): string => (crlf ? s.replace(/\r?\n/g, '\r\n') : s)
      let text = raw
      let totalReps = 0
      for (let k = 0; k < edits.length; k++) {
        const { replaceAll } = edits[k]
        const oldStr = fit(edits[k].oldStr)
        const newStr = fit(edits[k].newStr)
        const label = edits.length > 1 ? ` (edit ${k + 1}/${edits.length})` : ''
        if (!oldStr) return { content: `edit_file: old_string is empty${label}`, isError: true }
        if (oldStr === newStr) return { content: `edit_file: old_string and new_string are identical${label} — nothing to change`, isError: true }
        const count = text.split(oldStr).length - 1
        if (count === 0) return { content: `old_string not found in ${file}${label}`, isError: true }
        if (count > 1 && !replaceAll) return { content: `old_string is not unique in ${file}${label} (${count} matches); pass replace_all or add context.`, isError: true }
        // Function replacer so `$`-sequences in new_string aren't treated as
        // regex substitutions (they'd be, with a plain-string replacement).
        text = replaceAll ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr)
        totalReps += replaceAll ? count : 1
      }
      if (ctx.rewind !== false) recordCheckpoint(file, raw, 'edit_file', Date.now())
      await fsp.writeFile(file, text, 'utf8')
      noteFileState(file)
      const whole = lineDiff(raw, text)
      const diff = diffLines(raw, text)
      const editWord = edits.length > 1 ? `${edits.length} edits, ` : ''
      return {
        content: `edited ${file} (${editWord}${totalReps} replacement${totalReps === 1 ? '' : 's'})`,
        linesAdded: whole.added,
        linesRemoved: whole.removed,
        diff: diff.length ? diff : undefined,
      }
    } catch (e) {
      return { content: `cannot edit ${file}: ${(e as Error).message}`, isError: true }
    }
  },
}

const GREP_TIMEOUT_MS = 30_000

// Turn a finished grep/rg run into a tool result. Exit 0 = matches, 1 = none,
// 2 = error (possibly with partial output, e.g. one unreadable directory).
function grepResult(r: RunResult, cwd: string, headLimit: number): ToolResult {
  if (r.aborted) return { content: '(aborted)', isError: true }
  if (r.error) return { content: `grep: failed to run: ${r.error}`, isError: true }
  if (r.timedOut) return { content: `grep: timed out after ${GREP_TIMEOUT_MS / 1000}s — narrow the search with \`path\` or \`glob\`.`, isError: true }
  let text = r.stdout.trimEnd()
  if (!text) {
    if (r.code === 0 || r.code === 1) return { content: 'no matches' }
    return { content: `grep: ${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}`, isError: true }
  }
  // Paths under the working directory read better (and cost fewer tokens) relative.
  const prefix = cwd + path.sep
  let lines = text.split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l))
  if (headLimit > 0 && lines.length > headLimit) {
    const extra = lines.length - headLimit
    lines = lines.slice(0, headLimit)
    lines.push(`… [${extra} more lines; narrow the search or raise head_limit]`)
  }
  text = lines.join('\n')
  const partial = r.code === 2 && r.stderr.trim() ? `\n[stderr]\n${r.stderr.trim().split('\n').slice(0, 3).join('\n')}` : ''
  return { content: clip(text) + partial }
}

const grep: ToolDef = {
  name: 'grep',
  description:
    'Search file contents for a regular expression (ripgrep syntax: `a|b` alternation, `\\d`, `(?i)`…). Hidden files are searched; .git and node_modules are skipped (and .gitignore is honoured when ripgrep is installed). ' +
    'Output modes: "content" (default) returns matching lines as path:line:text; "files_with_matches" lists just the files; "count" gives per-file match counts. Use `glob` to restrict the files searched (e.g. `*.ts` or `*.{ts,tsx}`).',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for.' },
      path: { type: 'string', description: 'Directory or file to search (default: working directory).' },
      glob: { type: 'string', description: 'Only search files matching this glob, e.g. *.ts or *.{ts,tsx}' },
      ignore_case: { type: 'boolean', description: 'Case-insensitive match.' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'content (default): matching lines; files_with_matches: file names only; count: matches per file.' },
      context: { type: 'number', description: 'Lines of context to show around each match (content mode, max 20).' },
      head_limit: { type: 'number', description: 'Return at most this many output lines.' },
      multiline: { type: 'boolean', description: 'Let the pattern match across line breaks (needs ripgrep).' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    const pattern = String(input.pattern ?? '')
    if (!pattern) return { content: 'grep: `pattern` is required', isError: true }
    const where = input.path ? resolve(ctx.cwd, String(input.path)) : ctx.cwd
    const mode = input.output_mode === 'files_with_matches' || input.output_mode === 'count' ? input.output_mode : 'content'
    const context = mode === 'content' ? Math.min(20, Math.max(0, Math.floor(Number(input.context)) || 0)) : 0
    const headLimit = Math.max(0, Math.floor(Number(input.head_limit)) || 0)
    const globs = input.glob ? expandBraces(String(input.glob)) : []
    const ignoreCase = input.ignore_case === true
    const multiline = input.multiline === true

    // Arguments are an argv array — the model's pattern/path/glob never meets a shell.
    if (hasBinary('rg')) {
      const args = ['--no-heading', '--with-filename', '--color', 'never', '--hidden', '-g', '!.git', '-g', '!node_modules', '--max-columns', '500', '--max-columns-preview']
      if (mode === 'content') args.push('--line-number')
      if (mode === 'files_with_matches') args.push('-l')
      if (mode === 'count') args.push('-c')
      if (context) args.push('-C', String(context))
      if (ignoreCase) args.push('-i')
      if (multiline) args.push('-U', '--multiline-dotall')
      for (const g of globs) args.push('-g', g)
      args.push('-e', pattern, '--', where)
      const r = await runFile('rg', args, { cwd: ctx.cwd, env: { ...process.env, RIPGREP_CONFIG_PATH: '' }, timeoutMs: GREP_TIMEOUT_MS, signal: ctx.signal })
      return grepResult(r, ctx.cwd, headLimit)
    }
    if (multiline) return { content: 'grep: multiline search needs ripgrep (`rg`), which is not installed.', isError: true }
    const args = ['-r', '-I', '-E', '-H', '--color=never', '--exclude-dir=node_modules', '--exclude-dir=.git']
    if (mode === 'content') args.push('-n')
    if (mode === 'files_with_matches') args.push('-l')
    if (mode === 'count') args.push('-c')
    if (context) args.push('-C', String(context))
    if (ignoreCase) args.push('-i')
    // GNU grep's --include matches the basename only; keep the last path segment of a path glob.
    for (const g of globs) args.push(`--include=${g.includes('/') ? g.slice(g.lastIndexOf('/') + 1) : g}`)
    args.push('-e', pattern, '--', where)
    const r = await runFile('grep', args, { cwd: ctx.cwd, timeoutMs: GREP_TIMEOUT_MS, signal: ctx.signal })
    if (mode === 'count') r.stdout = r.stdout.split('\n').filter((l) => l && !l.endsWith(':0')).join('\n')
    return grepResult(r, ctx.cwd, headLimit)
  },
}

// --- glob: dependency-free recursive match ---
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache'])
const GLOB_MAX_RESULTS = 2000
const GLOB_MAX_VISITED = 200_000
const GLOB_MAX_DEPTH = 40

interface WalkState { visited: number; truncated: boolean }

// Walk `dir`, testing each file's path (relative to the walk root, '/'-separated)
// against `re` AS WE GO — so a big tree can't crowd matches out of the result —
// and stop once GLOB_MAX_RESULTS are found. Symlinks are listed but never followed.
async function walkGlob(dir: string, rel: string, re: RegExp, keep: Set<string>, out: string[], st: WalkState, depth: number): Promise<void> {
  if (st.truncated || depth > GLOB_MAX_DEPTH) return
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    if (st.truncated) return
    if (++st.visited > GLOB_MAX_VISITED) { st.truncated = true; return }
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      // Build/dependency dirs are skipped unless the pattern names them outright.
      if (SKIP_DIRS.has(e.name) && !keep.has(e.name)) continue
      await walkGlob(path.join(dir, e.name), r, re, keep, out, st, depth + 1)
    } else if (re.test(r)) {
      out.push(r)
      if (out.length >= GLOB_MAX_RESULTS) { st.truncated = true; return }
    }
  }
}

// An absolute pattern (`/repo/src/**/*.ts`) is split at its last literal directory
// into a walk root and a relative pattern; a relative one is used as given.
function splitPattern(pattern: string, base: string): { root: string; rel: string } {
  const p = pattern.replace(/^\.\//, '')
  if (!path.isAbsolute(p)) return { root: base, rel: p }
  const g = p.search(/[*?[{]/)
  if (g < 0) return { root: path.dirname(p), rel: path.basename(p) }
  const cut = p.lastIndexOf('/', g)
  return { root: cut <= 0 ? '/' : p.slice(0, cut), rel: p.slice(cut + 1) }
}

const globTool: ToolDef = {
  name: 'glob',
  description: 'Find files whose path matches a glob pattern (e.g. **/*.ts, src/*.tsx, **/*.{ts,tsx}). Returns paths relative to the search root, sorted; dependency/build dirs (node_modules, .git, dist, .cache) are skipped unless the pattern names them.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern.' },
      path: { type: 'string', description: 'Root directory to search from (default: working directory).' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    const base = input.path ? resolve(ctx.cwd, String(input.path)) : ctx.cwd
    const { root, rel } = splitPattern(String(input.pattern ?? '*') || '*', base)
    const re = globToRegExp(rel)
    const keep = new Set(rel.split('/').filter((s) => s && !hasGlobChars(s)))
    const files: string[] = []
    const st: WalkState = { visited: 0, truncated: false }
    try { await fsp.access(root) } catch { return { content: `glob: ${root} does not exist`, isError: true } }
    await walkGlob(root, '', re, keep, files, st, 0)
    files.sort()
    if (!files.length) return { content: st.truncated ? 'no files match (search stopped early: the tree is very large — narrow `path` or the pattern)' : 'no files match' }
    const note = st.truncated ? `\n… [results capped at ${GLOB_MAX_RESULTS}; narrow the pattern or \`path\`]` : ''
    return { content: clip(files.join('\n')) + note }
  },
}

const LIST_MAX_ENTRIES = 2000

const listDir: ToolDef = {
  name: 'list_dir',
  description: 'List the entries of a directory (files and subdirectories).',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory path (default: working directory).' } },
  },
  async run(input, ctx) {
    const dir = input.path ? resolve(ctx.cwd, String(input.path)) : ctx.cwd
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      const rows = entries
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      const shown = rows.slice(0, LIST_MAX_ENTRIES)
      const more = rows.length > shown.length ? `\n… [${rows.length - shown.length} more entries]` : ''
      return { content: clip(shown.length ? shown.join('\n') : '(empty directory)') + more }
    } catch (e) {
      return { content: `cannot list ${dir}: ${(e as Error).message}`, isError: true }
    }
  },
}

// The basic (non-orchestration) tools, in the order they appear in the registry.
export { bash, readFile, writeFile, editFile, grep, globTool, listDir }
