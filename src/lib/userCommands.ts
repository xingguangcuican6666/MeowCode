import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type { SlashCommand } from '../types'
import { parseFrontmatter } from './frontmatter'
import { expandArgs } from './skills'
import { activeEntry } from './entries'

// Custom slash commands, like Claude Code's project/user commands. Each is a
// Markdown file whose name is the command name and whose body is a prompt
// template ($ARGUMENTS / $1..$9). Running one sends the expanded body to the
// model as a user turn.
// Merge order: entry (when one is active) → user-global → project-local, with
// later dirs overriding earlier ones on a name clash. No entry → the legacy two
// dirs, byte-for-byte.
export function commandDirs(cwd = process.cwd()): string[] {
  const dirs: string[] = []
  const entry = activeEntry()
  if (entry) dirs.push(path.join(entry.dir, 'commands'))
  dirs.push(path.join(os.homedir(), '.anycode', 'commands'), path.join(cwd, '.anycode', 'commands'))
  return dirs
}

function readCommandDir(dir: string): SlashCommand[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SlashCommand[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    let raw: string
    try {
      raw = fs.readFileSync(path.join(dir, e.name), 'utf8')
    } catch {
      continue
    }
    const { meta, body } = parseFrontmatter(raw)
    const name = (meta.name || e.name.replace(/\.md$/i, '')).toLowerCase()
    const aliases = meta.aliases ? meta.aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) : undefined
    out.push({
      name,
      aliases,
      description: meta.description || 'Custom command',
      run(ctx) {
        const prompt = expandArgs(body, ctx.args)
        if (ctx.send) ctx.send(prompt)
        else ctx.print(prompt, 'user') // print mode: no autonomous driver to send
      },
    })
  }
  return out
}

// Project-local commands override user-global ones on name clash.
export function loadUserCommands(cwd = process.cwd()): SlashCommand[] {
  const byName = new Map<string, SlashCommand>()
  for (const dir of commandDirs(cwd)) for (const c of readCommandDir(dir)) byName.set(c.name, c)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
