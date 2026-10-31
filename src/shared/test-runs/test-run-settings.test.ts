import { describe, expect, it } from 'vitest'
import { DEFAULT_TEST_RUN_SETTINGS, normalizeTestRunSettings } from './test-run-settings'

describe('normalizeTestRunSettings', () => {
  it('keeps valid local env and presets', () => {
    const settings = {
      localEnv: { TEST_ENV: 'local' },
      presets: [{ name: 'dev', env: { TEST_ENV: 'dev', E2E_LANE: 'eshop' } }]
    }
    expect(normalizeTestRunSettings(settings)).toEqual(settings)
  })

  it('drops invalid env keys, values and preset names', () => {
    expect(
      normalizeTestRunSettings({
        localEnv: { TEST_ENV: 'local', 'bad key': 'x', LOWER_ok: 'y', NUM: 3 },
        presets: [
          { name: 'Dev Server', env: {} },
          { name: 'staging', env: { TEST_ENV: 'staging', '1BAD': 'z' } },
          { name: 'no-env' }
        ]
      })
    ).toEqual({
      localEnv: { TEST_ENV: 'local' },
      presets: [{ name: 'staging', env: { TEST_ENV: 'staging' } }]
    })
  })

  it('keeps the first of duplicate presets', () => {
    expect(
      normalizeTestRunSettings({
        presets: [
          { name: 'dev', env: { TEST_ENV: 'dev' } },
          { name: 'dev', env: { TEST_ENV: 'other' } }
        ]
      }).presets
    ).toEqual([{ name: 'dev', env: { TEST_ENV: 'dev' } }])
  })

  it('falls back to defaults for garbage', () => {
    expect(normalizeTestRunSettings('nope')).toEqual(DEFAULT_TEST_RUN_SETTINGS)
    expect(normalizeTestRunSettings({ localEnv: [], presets: {} })).toEqual(
      DEFAULT_TEST_RUN_SETTINGS
    )
  })
})
