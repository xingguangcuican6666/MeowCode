import path from 'node:path'
import fs from 'node:fs'
import type { AppConfig } from './types'
import { DEFAULT_THEME } from './theme'
import { settingsDefaults } from './lib/settings'
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
  const cfg: AppConfig = { ...defaults(), ...fileCfg }
  // Merge the settings bag key-by-key so a file written by an older build (with
  // fewer keys) still picks up defaults for any settings added since.
  cfg.settings = { ...settingsDefaults(), ...(fileCfg.settings ?? {}) }
  // The environment key always wins and is never read from disk.
  if (process.env.ANTHROPIC_API_KEY) cfg.apiKey = process.env.ANTHROPIC_API_KEY
  // Entry layering: with an entry active (activated by the CLI before this
  // runs) its settings.json and entry.json overrides merge on top; global mode
  // is a pass-through returning the same object.
  return applyEntryOverrides(cfg)
}

export function saveConfig(cfg: AppConfig): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    // Never persist the API key to disk; it comes from the environment.
    const { apiKey: _omit, ...persist } = cfg
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(persist, null, 2))
  } catch {
    // best-effort; config persistence is non-critical
  }
}
