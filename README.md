# MeowCode

A Claude Code–style agentic coding CLI. This is the **framework skeleton** — the
terminal UI, streaming loop, slash-command system, and a pluggable provider
layer are all in place. Real agent capabilities (tools, file edits, planning)
are meant to be layered on next.

## Quick start

```bash
npm install
npm run dev        # interactive session (mock provider, no API key needed)
```

Build a standalone CLI:

```bash
npm run build      # bundles to dist/cli.js with a shebang
node dist/cli.js   # or: npm link  → then run `meowcode`
```

## Using a real model

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev        # provider auto-switches to `anthropic`
```

The Anthropic provider streams via the Messages API using the built-in `fetch`
(no SDK dependency).

## Non-interactive / scripting

```bash
meowcode -p "explain this repo"
echo "write a haiku about tps reports" | meowcode
```

## Commands

`/help` · `/model <id>` · `/provider <mock|anthropic>` · `/config` · `/entry` · `/clear` · `/version` · `/exit`

## Config location

All user state lives in `~/.meowcode/` — `settings.json`, `sessions/`,
`memory/`, `credentials.json`, `history.json`, and `entries/`.

This tool was called **AnyCode** before; its config directory was `~/.anycode`.
That directory is no longer read. On the next interactive start, if `~/.anycode`
still holds data and `~/.meowcode` is empty, MeowCode asks whether to merge it
in — a dialog with the same keys and mouse support as the rest of the UI
(`↑↓`/wheel to move, `1`–`2` to jump, `↵`/click to confirm, `y`/`n` to answer
directly, `esc` to skip). The merge is additive and never deletes the old
directory, so you can check the result and remove `~/.anycode` yourself. To
skip the prompt:

```bash
mv ~/.anycode ~/.meowcode     # or merge by hand
```

Non-interactive runs (print mode, pipes, CI) print a one-line notice with the
same `mv` hint instead of prompting.

## Entries (front-ends)

An entry is a **complete front-end of its own** — its own UI and wiring, driven
by the same agent — not a per-user profile. A plugin can ship one that replaces
the whole terminal UI (a web front-end, a tray app); the built-in terminal UI is
itself just an entry, named `tui`, materialized as `~/.meowcode/entries/tui/` on
first start.

```bash
meowcode                     # start the default entry, or the built-in tui
meowcode tui                 # ...explicitly, the built-in terminal UI
meowcode work                # start a specific entry (argv shorthand)
meowcode --entry work        # same, as an explicit flag
meowcode entry new work      # create one (writes its entry.json manifest)
meowcode entry use work      # make it the default (~/.meowcode/entry.json)
```

`/entry` opens an interactive menu — pick an entry, then set it as the startup
default, show its details, or remove it. The subcommands stay for scripting:
`/entry list`, `/entry current`, `/entry new <name>`, `/entry default [name|off]`,
`/entry remove <name> [--force]`.

Entries bind at startup (no hot-switching), so every message says a restart is
needed. Sessions and memory are **shared** across entries — switching front-ends
does not fork your history.

```
~/.meowcode/
  settings.json                 ← global base config
  sessions/  memory/  projects/ history.json   ← shared by every entry
  entry.json                    ← { "default": "<name>" }; absent ⇒ tui
  entries/
    tui/    entry.json  settings.json          ← built-in, materialized at startup
    meowui/ entry.json  settings.json  skills/ commands/ agents/
```

Each entry dir holds:

- `entry.json` — manifest and highest-precedence config overrides
  (`description`, `model`, `provider`, `theme`, `settings`, `hooks`,
  `mcpServers`, `permissions`, `customProviders`, `launcher`).
- `settings.json` — the entry's saved config. Layering, low → high: built-in
  defaults → global `~/.meowcode/settings.json` → entry `settings.json` →
  entry `entry.json`.
- `skills/`, `commands/`, `agents/` — per-entry content, same lookup order.

Credentials, usage stats, and the update cache stay machine-global. The API key
always comes from the environment (`ANTHROPIC_API_KEY`), never from an entry.

### Installing shared entries

`meowcode entry install` creates an entry from a template shipped in an npm
package, a git URL, or a local path:

```bash
meowcode entry install <npm-package>
meowcode entry install <git-url>
meowcode entry install <local-path>
meowcode entry remove <name>    # delete an entry's directory
```

A template package declares its entry in `package.json` under
`"meowcode.entry"`; install never overwrites existing files, so reinstalling
keeps your local edits.

```json
{
  "name": "my-meowcode-entry",
  "meowcode": {
    "entry": {
      "description": "A Web front-end for the same agent",
      "model": "claude-opus-4-8",
      "settings": { "effort": "high" },
      "content": {
        "skills": { "review": "# Review\n..." },
        "commands": { "standup.md": "Summarize what changed since yesterday." },
        "agents": { "explorer": "You are a code exploration agent." }
      }
    }
  }
}
```

### Entries with a launcher (has-entry plugins)

Most entries are just config + content for the normal TUI. An entry can also
change *how MeowCode starts*: its `entry.json` may declare a `launcher`
front-end (e.g. a web UI). When that entry is active, `meowcode` skips the Ink
TUI entirely and spawns the launcher instead — the plugin drives the agent
through a JSON-RPC bridge, and the transcript lands in the shared `sessions/`
(`/resume`-compatible, same as in the TUI).

The plugin is the JSON-RPC **client** and MeowCode the **server**, over the
child's stdin/stdout (newline-delimited JSON-RPC 2.0 — same framing as MCP
servers, opposite direction). On startup the host sends one `initialize`
request — `{ protocolVersion: "2025-meowcode-launcher-1", serverInfo: { name,
version } }` — which the plugin answers (any result value), then:

| Direction | Method | Payload → result |
|---|---|---|
| plugin → host | `agent/turn` | `{ prompt }` → `{ turn }`: runs one full agent turn (tool loop included), streaming progress as `agent/event` notifications |
| host → plugin | `agent/event` | `{ turn, event }`: one `AgentEvent` (`text` / `thinking` / `tool_use` / `tool_result` / `usage` / `error` / `workflow` / `agent`) |
| plugin → host | `tools/list` | `{}` → `{ tools }` (Anthropic-format schemas) |
| plugin → host | `tools/call` | `{ name, input }` → the `ToolResult` |
| plugin → host | `config/get` | `{}` → the effective `AppConfig` (apiKey stripped) |
| plugin → host | `session/state` | `{}` → `{ sessionId, messages, usage }` |
| plugin → host | `session/reset` | `{}` → `{ sessionId }`: drops the transcript (like `/clear`) |

Rules of the road:

- `entry.json` form: `"launcher": { "command": "node", "args":
  ["launcher.js"] }`. Relative `command`/`args` resolve against the **entry
  dir** (shipped plugin files live there); `cwd` defaults to the entry dir;
  optional `env` adds variables. `meowcode entry install` copies these
  referenced files into the entry, as it does for relative `mcpServers` args.
- One turn at a time — a second `agent/turn` while one streams is rejected.
- Headless: turns run with `bypassPermissions` (the plugin owns interaction and
  gates before calling), but the entry's `permissions` deny/allow rules still
  bind. Hooks fire when the entry brings them; there is nobody to answer
  `requestUserInput`, so the `ask_user` tool reports that by itself.
- Session state lives in the host, so the plugin can stay stateless. Print mode
  (`-p` / `--print`) bypasses the launcher and uses the normal non-interactive
  path.
- Entry `mcpServers` start with the host (the TUI never mounts in launcher
  mode). Discovery is async — a server's `mcp__*` tools appear in `tools/list`
  once its handshake completes (same "next turn" semantics as the TUI), so a
  plugin should re-list before its first `agent/turn` if it needs them.
- `/entry` and `meowcode entry list` mark these entries `[launcher]`.

Minimal plugin sketch (node) — answer `initialize`, run one turn, exit (the
host saves the transcript):

```js
// launcher.js — toy front-end: one turn, log events to stderr, exit
const readline = require('node:readline');
let id = 1;
const pending = new Map();
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id && !msg.method) pending.get(msg.id)?.(msg.result); // host reply
  else if (msg.method === 'agent/event') process.stderr.write(`[${msg.params.turn}] ${msg.params.event.type}\n`);
  else if (msg.id) send({ jsonrpc: '2.0', id: msg.id, result: {} }); // initialize
});
const call = (method, params) => new Promise((res) => {
  const i = id++; pending.set(i, res);
  send({ jsonrpc: '2.0', id: i, method, params });
});
(async () => {
  await call('config/get', {});
  const { turn } = await call('agent/turn', { prompt: 'Say hi in one line.' });
  const state = await call('session/state', {});
  process.stderr.write(`turn ${turn}: ${state.messages.at(-1)?.content}\n`);
  process.exit(0);
})();
```

## Layout

```
src/
  cli.tsx            entry point (arg parsing, print mode, render)
  app.tsx            Ink app: layout, global keys, elapsed timer
  theme.ts           colors + symbols
  types.ts           Message / Provider / Command contracts
  config.ts          ~/.meowcode/settings.json load/save
  hooks/useChat.ts   conversation state machine + streaming
  components/        Banner · Message · StatusLine · PromptInput
  commands/          slash-command registry
  providers/         mock (offline) + anthropic (real, fetch/SSE)
  lib/               markdown rendering · spinner frames · token estimate
```

## Extending

- **Add a command:** push a `SlashCommand` onto `registry` in `src/commands/index.ts`.
- **Add a provider:** implement the `Provider` interface and register it in `src/providers/index.ts`.
- **Add tools / file edits:** give a provider access to a tool loop and render
  `tool` messages in `src/components/Message.tsx` (the role already exists).
