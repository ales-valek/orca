import type { TestResultRecord } from './test-run-types'

export type TestResultState = 'passed' | 'failed' | 'skipped'

/** Failed means Playwright did not get what the test expected; a pinned known failure passes. */
export function getTestResultState(
  result: Pick<TestResultRecord, 'outcome' | 'status'>
): TestResultState {
  if (result.outcome === 'unexpected') {
    return 'failed'
  }
  return result.status === 'skipped' ? 'skipped' : 'passed'
}
