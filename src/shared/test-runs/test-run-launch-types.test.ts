import { describe, expect, it } from 'vitest'
import { isTestRunLaunch, type TestRunLaunch } from './test-run-launch-types'

describe('isTestRunLaunch', () => {
  it('tells a started launch from a refusal, though both carry an error field', () => {
    const launch: TestRunLaunch = {
      id: 'l1',
      state: 'queued',
      title: 'All tests',
      targetLabel: 'Kiosek',
      worktreeId: null,
      startedAt: 1,
      endedAt: null,
      runId: null,
      error: null
    }
    expect(isTestRunLaunch(launch)).toBe(true)
    expect(isTestRunLaunch({ error: 'This target no longer exists.' })).toBe(false)
  })
})
