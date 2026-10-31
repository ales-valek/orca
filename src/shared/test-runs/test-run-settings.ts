import { getStringRecord, isRecord, mapValid } from '../dev-env/dev-env-settings-values'

export type TestRunEnvFiles = {
  /** Absolute folder holding the env files, e.g. a checkout's tests/ with .env and .env.dev. */
  from: string
  /** Folder inside the source to copy missing files into, e.g. 'tests'. */
  to: string
}

export type TestRunPreset = {
  name: string
  env: Record<string, string>
  envFiles?: TestRunEnvFiles
}

export type TestRunSettings = {
  /** Extra env for runs against a local Dev Environment, e.g. { TEST_ENV: 'local' }. */
  localEnv: Record<string, string>
  /** Named shared targets, e.g. { name: 'dev', env: { TEST_ENV: 'dev' } }. */
  presets: TestRunPreset[]
}

export const DEFAULT_TEST_RUN_SETTINGS: TestRunSettings = { localEnv: {}, presets: [] }

const PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/
const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/

function normalizeEnv(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getStringRecord(value)).filter(([key]) => ENV_KEY_PATTERN.test(key))
  )
}

function normalizeEnvFiles(value: unknown): TestRunEnvFiles | undefined {
  if (!isRecord(value) || typeof value.from !== 'string' || typeof value.to !== 'string') {
    return undefined
  }
  const isInsideSource =
    !ABSOLUTE_PATH_PATTERN.test(value.to) && !value.to.split(/[\\/]/).includes('..')
  return ABSOLUTE_PATH_PATTERN.test(value.from) && isInsideSource
    ? { from: value.from, to: value.to }
    : undefined
}

function normalizePreset(value: unknown): TestRunPreset | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !PRESET_NAME_PATTERN.test(value.name)) {
    return null
  }
  if (!isRecord(value.env)) {
    return null
  }
  const envFiles = normalizeEnvFiles(value.envFiles)
  return { name: value.name, env: normalizeEnv(value.env), ...(envFiles ? { envFiles } : {}) }
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
