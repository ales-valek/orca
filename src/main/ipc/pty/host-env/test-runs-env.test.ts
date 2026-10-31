import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyTestRunsEnv } from './test-runs-env'

const USER_DATA = '/data/orca'

describe('applyTestRunsEnv', () => {
  it('sets the reporter and runs dir', () => {
    const env: Record<string, string> = {}
    applyTestRunsEnv(env, { userDataPath: USER_DATA, isWsl: false })
    expect(env).toEqual({
      ORCA_PLAYWRIGHT_REPORTER: join(USER_DATA, 'test-runs', 'orca-playwright-reporter.cjs'),
      ORCA_PLAYWRIGHT_LOCK: join(USER_DATA, 'test-runs', 'orca-playwright-lock.cjs'),
      ORCA_TEST_RUNS_DIR: join(USER_DATA, 'test-runs')
    })
  })

  it('replaces values inherited from another Orca instance', () => {
    const env: Record<string, string> = { ORCA_TEST_RUNS_DIR: '/other-orca/test-runs' }
    applyTestRunsEnv(env, { userDataPath: USER_DATA, isWsl: false })
    expect(env.ORCA_TEST_RUNS_DIR).toBe(join(USER_DATA, 'test-runs'))
  })

  it('skips WSL shells', () => {
    const env: Record<string, string> = { ORCA_PLAYWRIGHT_LOCK: '/other/lock.cjs' }
    applyTestRunsEnv(env, { userDataPath: USER_DATA, isWsl: true })
    expect(env).toEqual({})
  })
})
