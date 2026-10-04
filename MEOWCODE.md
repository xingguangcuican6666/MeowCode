# MEOWCODE.md

This file is auto-loaded into every turn (see `src/lib/projectInstructions.ts` — it
is this repo's own agent-instruction mechanism). It is written for a coding agent
working in **MeowCode itself**, so most of the "what is this" detail that lives in
`README.md` is deliberately omitted here.

## What this project is

MeowCode is a Claude-Code-style agentic coding CLI. The npm package, the `git`
command and the user-facing text all say "MeowCode"; the `~/.meowcode/` config
directory is the only trace of the original "AnyCode" name it was cloned from,
and `lib/legacyDir.ts` handles migrating users off it.

Notable: **the agent loop is self-hosted**. There is no SDK — the `anthropic`
provider speaks the Messages API over raw `fetch`/SSE, and the entire toolset
(bash, file edits, sub-agents, message/memory/monitor/schedule, etc.) is
implemented in-repo under `src/tools/`, mirroring Claude Code's tools one-for-one.
The default `default` provider is an **unwired stub** (`src/providers/index.ts`);
real work runs on `anthropic` (env `ANTHROPIC_API_KEY`), the logged-in `newapi`
relay, or a user-defined Anthropic-protocol endpoint.

## Commands

```bash
npm run dev         # interactive session; tsx src/cli.tsx (mock provider, no key)
npm run build       # tsup → dist/cli.js (ESM, shebang)
node dist/cli.js    # run the bundle (or: npm link → `meowcode`)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src (flat config: eslint.config.mjs; react-hooks rules on)
npm run test        # vitest run (unit tests live next to sources as *.test.ts)
npm run clean       # rm -rf dist
npm run start       # node dist/cli.js
```

- Verification story: `typecheck` + `lint` + `test` + `build`. Lint errors are
  blocking; non-null assertions and react-hooks/exhaustive-deps are warnings.
  Always run all four before finishing.
- **CI** (`.github/workflows/build.yml`) installs with **Bun** and runs
  `bun run typecheck` + `bun run lint` + `bun run test` + `bun run build`. The
  repo is `"type": "module"` (ESM, `ESNext`/`Bundler` resolution); imported
  local modules use extensionless paths.
- `.gitignore` excludes `dist/`, `node_modules/`, and `.meowcode/` (the user's
  config/sessions/memory live in `~/.meowcode`, **not** in the repo).

## Runtime notes

- Default model is `claude-opus-4-8` (`src/config.ts`); provider defaults to
  `mock` unless `ANTHROPIC_API_KEY` is set.
- Config, sessions, and cross-session memory persist to `~/.meowcode/`:
  `settings.json`, `sessions/`, `memory/` (`MEMORY.md` index), `credentials.json`,
  `history.json`. API keys are **never** written to disk — always env-sourced.
- The pre-rename `~/.anycode/` is dead: `src/lib/legacyDir.ts` detects it at
  startup (before the entry is resolved, before the TUI mounts) and offers an
  **additive** merge into `~/.meowcode` — nothing is ever deleted from the old
  dir, existing destination files are never clobbered, and a marker file stops
  the nagging. Skipped silently once `~/.meowcode` holds any state; non-TTY runs
  print a one-line `mv` hint instead of prompting. The question itself is an Ink
  dialog (`components/LegacyDirDialog.tsx`): cli.tsx mounts it on the alternate
  screen in the session's own theme/language (keyboard + mouse, same contract as
  the other pickers), then `reportMergeOutcome` writes the one-line result on the
  normal screen. `legacyDir.ts` stays Ink-free — `offerLegacyMigration(ask)` takes
  the answer as a callback, so the unit tests drive it without a terminal.
- UI language is i18n'd (zh/en/auto) — see `src/lib/i18n.ts`; the codebase has
  substantial Chinese comments and some Chinese UI strings.

### Entries (front-ends)

`src/lib/entries.ts` — an entry is a **complete front-end of its own** (its own
UI and wiring, driven by the same agent), NOT a per-user profile, and NOT
something the user types into existence: entries exist because a plugin shipped
one and it was installed. The built-in terminal UI is itself an entry, `tui`
(`BUILTIN_ENTRY`), materialized as `~/.meowcode/entries/tui/` by
`materializeBuiltinEntry()` at startup (idempotent, never clobbers; `entry remove
tui` is refused).

- Per entry: `entry.json` (manifest + overrides), `settings.json` (config saved
  while active), content (`skills/ commands/ agents/`).
- **Shared by every entry** (at the `~/.meowcode` root, NOT under the entry):
  `sessions/`, `memory/` (incl. `projects/`), `history.json`, `mailbox/`,
  `memory.json`. An entry swaps the surface, never the history — so
  `stateDir()`/`stateFile()` ignore the active entry.
- Chosen once at CLI startup: `--entry <name>` → `meowcode <name>` shorthand →
  default in `~/.meowcode/entry.json` (`{ "default": name }`) → else `tui`.
  **No hot-switch** — restart to change entries. With no entry explicitly active,
  behavior is byte-identical to global mode: `tui`'s own files ARE the global ones.
- Config layering (low → high): defaults → global `settings.json` → entry
  `settings.json` → `entry.json` overrides (`applyEntryOverrides`, called from
  `loadConfig`). `settings` bag merges key-by-key; bag keys (hooks/mcpServers/
  permissions/customProviders) replace whole when `entry.json` carries them.
- Content resources resolve **entry → global → project**.
- Machine-global (never per-entry): `credentials.json`, usage stats, update
  cache. API key is always env-sourced, never from entry files.
- Config persistence goes through `entryAwareSaveConfig` (global mode → plain
  `saveConfig`). Installer: `meowcode entry install <npm pkg | git url | local
  path>` reads the `meowcode.entry` template field from the package manifest;
  `meowcode entry remove <name>` deletes (refuses `tui`, and refuses
  per-entry `sessions/`/`memory/` without `--force`). `createEntry` never
  overwrites files.
- **An entry cannot be created by hand.** It is a whole front-end shipped by a
  plugin, so `createEntry` is the installer's alone: `/entry new` and
  `meowcode entry new` both refuse with a pointer to `entry install`, and the
  menu has no "new entry" row. The list is a readout of the installed set.
- `/entry` bare opens the interactive menu (`components/EntryPicker.tsx`: list →
  actions, keyboard + mouse); the subcommands (`/entry list|current|default|
  remove`) stay for scripts and non-TTY runs, where bare `/entry` prints the
  list instead.
- Has-entry plugins (`src/lib/launcher.ts`): an entry's `entry.json` may declare
  `"launcher": { "command", "args?", "cwd?", "env?" }`; when active the CLI
  skips the Ink TUI and spawns the front-end over newline-delimited JSON-RPC
  2.0 stdio (plugin = client, host = server; handshake `initialize` with
  protocol `2025-meowcode-launcher-1`). Host methods: `agent/turn` (+
  `agent/event` stream), `tools/list`, `tools/call`, `config/get` (no apiKey),
  `session/state`, `session/reset`. Transcript stays host-side (TUI-identical
  rows, `/resume`-compatible, autosaved to the shared `sessions/`); turns run
  `bypassPermissions` with entry `permissions` rules bound. Print mode bypasses
  the launcher. Lists mark these entries `[launcher]` and the built-in one
  `[内置]`.
- Keyboard decoding lives in `src/lib/inkinput.ts` (`decodeInput`), on top of
  `src/lib/keychunks.ts` (`decodeChunk`). Neither of Ink's `useInput` arguments is
  enough alone, and each fails in the opposite direction. `parseKeypress` reports
  ONE keypress per stdin read, so `key` loses everything after the first key of a
  batch (a fast "2⏎" loses the ⏎; "↓⏎" loses the ⏎). But use-input.js
  blanks `input` for every key it can *name* (up/down/pageup/pagedown/home/end/
  delete/escape), so a plain arrow arrives as `input === ''` and the bytes never
  reach a `decodeChunk`-only callback. `decodeInput({ input, key }, handlers)`
  walks the chunk and consults the flags only when the chunk carried no
  characters — never both, or a batch double-counts its first key. Pass Ink's two
  arguments straight into it; read it before adding a new picker.

## Architecture

```
src/
  cli.tsx               entry: arg parsing, print/piped mode, interactive mount loop
  app.tsx               the Ink app (large — global keys, layout, ~1870 LOC)
  app.tsx + app-helpers.ts   session snapshot, goal/loop state, foldContext wiring
  types.ts              core contracts: Message, MessageMeta, StreamOpts, Provider,
                        AgentEvent, ToolResultBlock, SlashCommand, CommandContext, etc.
  config.ts             ~/.meowcode/settings.json load/save
  theme.ts              color themes + useTheme()/ThemeProvider
  hooks/useChat.ts      conversation state machine + streaming (foldContext/compact)
  components/           Ink components; PromptInput (~715), SettingsPanel (~590), etc.
  commands/index.ts     slash-command registry (~1310 LOC)
  providers/            mock (offline) · anthropic (fetch/SSE tool loop) · wire/retry
  tools/                the agent toolset
    index.ts            registry + Anthropic-format schemas + dispatcher
    impl.ts             the ordered TOOLS list (assembled from fs-tools/…/orchestration)
    fs-tools.ts         bash, read_file, write_file, edit_file, grep, glob, list_dir
    orchestration.ts    task / plan / workflow / agent_status / agent_wait
    permission.ts       permission-mode + per-tool rules (allow/ask/deny)
    memory-tool.ts      the cross-session `memory` tool
  lib/                  ~60 leaf modules (agents, mcp, sessions, transcript, i18n,
                        compact, summarize, usage, tokens, mentions, hooks, …)
```

The **agent loop** lives in `src/providers/anthropic.ts` (`agent(...)`): it builds
the tool schemas, streams SSE, runs tools, handles retries / context-overflow
compaction / OAuth refresh / plan-mode approval. The mock provider (`mock.ts`)
implements a synthetic offline loop over the same tools, so the UI works without a
key. The **UI is entirely Ink + React** (v18, `~18.3.1` react, `~5.1.0` ink).

## Conventions

- `src/types.ts` stays **dependency-free** by design: config types like hooks /
  MCP / permissions are kept loose (`Record<string, …>`) and typed properly in the
  owning `lib/` module instead. Follow that split.
- New toggles/settings are **one line** in the `SETTINGS` table
  (`src/lib/settings.ts`) — this drives `/config`, validation, and defaults.
  Effort levels (`low…max`), thinking budgets, and output-style directives all
  live there too.
- The `settings` bag on `AppConfig` is a `Record<string, boolean|string|number>`,
  merged key-by-key against `settingsDefaults()` so files from older builds still
  pick up new keys.
- New slash command: push a `SlashCommand` onto `builtins`
  (`src/commands/index.ts`). New tool: define it in `src/tools/` and add it to the
  `TOOLS` array in `impl.ts`. New provider: register in `src/providers/index.ts`.
- Import local modules with extensionless paths; no `import type` elision issues
  (JSX `automatic`, `react-jsx`).
- Markdown rendering is `src/lib/markdown.ts` (`renderMarkdown`, wrapping `marked`
  + `marked-terminal`); spinner frames, token estimation, etc. are siblings in
  `src/lib/`.

## Gotchas

- **`tsup` version drift:** `package.json` declares `^8.3.5` but the lockfile
  resolves `8.5.1`. Don't assume APIs exact across that range.
- **`marked-terminal.d.ts`** is a local type shim (in `src/`) for the
  `marked-terminal` import; be careful editing it.
- The **default `default` provider is a stub** and should not be "fixed" by
  pointing it at a hardcoded vendor — wire it via the existing provider layer.
- `exit_plan_mode` only surfaces in plan mode (`toolSchemas(..., planMode)`); the
  `workflow` tool is dropped when `dynamicWorkflows` is off; `task`/`plan`/`workflow`
  are withheld from sub-agents to cap nesting at one level.
- Mid-turn auto-compaction and context-overflow retry are implemented in
  `providers/anthropic.ts` (`compactConvo`, `pickCut`, `MAX_STEPS = 1000`) — do not
  assume Claude's exact thresholds there.
- **Reasoning/agent orchestration sub-features** defined by this repo's own system
  prompt (todo lists, effort levels, workflows) are concrete tools here — when you
  add one, it appears in `TOOLS` and its schema goes to the model.