import path from 'node:path'
import fs from 'node:fs'
import type { AppConfig } from './types'
import { DEFAULT_THEME } from './theme'
import { settingsDefaults } from './lib/settings'
import { loadApiKey, saveApiKey } from './lib/credentials'
// Kept as a re-export so every existing `import { CONFIG_DIR } from '../config'`
// keeps working unchanged.
export { CONFIG_DIR } from './lib/configDir'
import { CONFIG_DIR } from './lib/configDir'
// Entry layering (see lib/entries.ts). This creates an ESM cycle
// config → entries → config. It is safe with live bindings: entries.ts reads
// CONFIG_DIR only at module scope (and CONFIG_DIR's own initializer lives in a
// third, dependency-free module — lib/configDir.ts — so there is no
// initialization-order hazard at all), and only calls saveConfig inside
// function bodies.
import { applyEntryOverrides } from './lib/entries'

export const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json')

function defaults(): AppConfig {
  return {
    provider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock',
    model: 'claude-opus-4-8',
    theme: DEFAULT_THEME,
    apiKey: process.env.ANTHROPIC_API_KEY,
    system: undefined,
    settings: settingsDefaults(),
  }
}

export function loadConfig(): AppConfig {
  let fileCfg: Partial<AppConfig> = {}
  try {
    fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<AppConfig>
  } catch {
    // no settings file yet — that's fine
  }
  const base: AppConfig = { ...defaults(), ...fileCfg }
  // Merge the settings bag key-by-key so a file written by an older build (with
  // fewer keys) still picks up defaults for any settings added since.
  base.settings = { ...settingsDefaults(), ...(fileCfg.settings ?? {}) }
  // The environment key always wins and is never read from disk.
  if (process.env.ANTHROPIC_API_KEY) base.apiKey = process.env.ANTHROPIC_API_KEY
  // Entry layering: with an entry active (activated by the CLI before this
  // runs) its settings.json and entry.json overrides merge on top; global mode
  // is a pass-through returning the same object.
  const cfg = applyEntryOverrides(base)
  // The `apiKeySetting` row has ONE home, and it is credentials.json — never
  // settings.json, which is a 0666 preferences file any account on the machine can
  // read, nor an entry's own settings.json, for the same reason. The row is
  // resolved LAST, after every layer has merged, and always from the credential
  // file: what the bag shows is what the provider will send, so a key hand-edited
  // into a settings file is IGNORED rather than honoured. (A bag claiming one key
  // while the provider used another is the worst outcome — the user edits a value
  // that never reaches the API, and the panel shows a key that isn't in force.)
  const storedKey = loadApiKey()
  if (storedKey) cfg.settings = { ...cfg.settings, apiKeySetting: storedKey }
  else {
    const { apiKeySetting: _drop, ...rest } = cfg.settings ?? {}
    cfg.settings = rest
  }
  return cfg
}

export function saveConfig(cfg: AppConfig): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    // Never persist the API key to disk; it comes from the environment. The
    // `apiKeySetting` row goes the other way — straight to credentials.json — so
    // the row must not even be PRESENT here, not merely stripped of its value.
    const { apiKey: _omit, ...persist } = cfg
    const { apiKeySetting, ...rest } = persist.settings ?? {}
    saveApiKey(String(apiKeySetting ?? ''))
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...persist, settings: rest }, null, 2))
  } catch {
    // best-effort; config persistence is non-critical
  }
}
