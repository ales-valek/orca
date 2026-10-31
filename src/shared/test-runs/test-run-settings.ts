import { getStringRecord, isRecord, mapValid } from '../dev-env/dev-env-settings-values'

export type TestRunPreset = { name: string; env: Record<string, string> }

export type TestRunSettings = {
  /** Extra env for runs against a local Dev Environment, e.g. { TEST_ENV: 'local' }. */
  localEnv: Record<string, string>
  /** Named shared targets, e.g. { name: 'dev', env: { TEST_ENV: 'dev' } }. */
  presets: TestRunPreset[]
}

export const DEFAULT_TEST_RUN_SETTINGS: TestRunSettings = { localEnv: {}, presets: [] }

const PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/

function normalizeEnv(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getStringRecord(value)).filter(([key]) => ENV_KEY_PATTERN.test(key))
  )
}

function normalizePreset(value: unknown): TestRunPreset | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !PRESET_NAME_PATTERN.test(value.name)) {
    return null
  }
  return isRecord(value.env) ? { name: value.name, env: normalizeEnv(value.env) } : null
}

export function normalizeTestRunSettings(value: unknown): TestRunSettings {
  if (!isRecord(value)) {
    return DEFAULT_TEST_RUN_SETTINGS
  }
  const presets = mapValid(value.presets, normalizePreset).filter(
    (preset, index, all) => all.findIndex((other) => other.name === preset.name) === index
  )
  return { localEnv: normalizeEnv(value.localEnv), presets }
}
