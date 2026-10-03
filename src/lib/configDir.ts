// The user-level config directory, in its own dependency-free module so that
// config.ts and lib/entries.ts can share it without a cycle: entries.ts reads
// CONFIG_DIR at module scope (ENTRIES_DIR, DEFAULT_ENTRY_FILE) while
// config.ts's loadConfig() calls back into entries.ts — with the const living
// in config.ts itself, whichever module evaluated first would read the other's
// half-initialized binding (TDZ ReferenceError). config.ts re-exports this
// binding, so every existing `import { CONFIG_DIR } from '../config'` keeps
// working unchanged.
import os from 'node:os'
import path from 'node:path'

export const CONFIG_DIR = path.join(os.homedir(), '.meowcode')
