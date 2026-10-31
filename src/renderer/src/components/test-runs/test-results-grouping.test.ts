import { describe, expect, it } from 'vitest'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { groupTestRows } from './test-results-grouping'
import { buildTestRows } from './test-rows'

const RUN: TestRunRecord = {
  id: 'r1',
  status: 'failed',
  startedAt: 1,
  endedAt: 2,
  pid: 1,
  trigger: 'agent',
  worktreeId: 'repo::/w',
  paneKey: null,
  repo: { root: '/w', originUrl: null, commit: null, branch: null },
  configFile: 'playwright.config.ts',
  argv: [],
  lane: null,
  totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 }
}

function entry(
  file: string,
  title: string,
  overrides: Partial<TestResultRecord> = {}
): { result: TestResultRecord; run: TestRunRecord } {
  return {
    run: RUN,
    result: {
      identity: `${file}|${title}`,
      configFile: 'playwright.config.ts',
      project: 'chromium',
      file,
      line: 1,
      titlePath: [title],
      tags: [],
      annotations: [],
      expectedStatus: 'passed',
      status: 'passed',
      outcome: 'expected',
      retry: 0,
      isFinalAttempt: true,
      durationMs: 1,
      error: null,
      attachments: [],
      stdout: '',
      stderr: '',
      ...overrides
    }
  }
}

describe('groupTestResults', () => {
  it('groups by spec folder with failed groups first', () => {
    const groups = groupTestRows(
      buildTestRows(
        [],
        [
          entry('tests/admin/tier-1/a.spec.ts', 'A'),
          entry('tests/eshop/tier-1/b.spec.ts', 'B ok'),
          entry('tests/eshop/tier-1/c.spec.ts', 'C bad', {
            status: 'failed',
            outcome: 'unexpected'
          }),
          entry('tests/eshop/tier-1/d.spec.ts', 'D skip', { status: 'skipped', outcome: 'skipped' })
        ]
      ),
      {}
    )
    expect(groups.map((group) => [group.label, group.counts])).toEqual([
      ['tests/eshop/tier-1', { passed: 1, failed: 1, skipped: 1, neverRun: 0 }],
      ['tests/admin/tier-1', { passed: 1, failed: 0, skipped: 0, neverRun: 0 }]
    ])
    expect(groups[0].rows.map((row) => row.latest?.result.titlePath[0])).toEqual([
      'C bad',
      'B ok',
      'D skip'
    ])
  })

  it('reads the tier per group', () => {
    const groups = groupTestRows(
      buildTestRows(
        [],
        [entry('tests/eshop/tier-3/a.spec.ts', 'A'), entry('e2e/smoke.spec.ts', 'B')]
      ),
      {}
    )
    expect(groups.map((group) => [group.label, group.tier])).toEqual([
      ['e2e', null],
      ['tests/eshop/tier-3', 3]
    ])
  })
})

describe('never-run tests', () => {
  it('counts tests that never ran and lists them last', () => {
    const [group] = groupTestRows(
      buildTestRows(
        [
          {
            identity: 'new',
            configFile: 'playwright.config.ts',
            project: 'chromium',
            file: 'tests/tier-1/new.spec.ts',
            line: 1,
            titlePath: ['A new test'],
            tags: [],
            annotations: [],
            isSerial: false
          }
        ],
        [entry('tests/tier-1/old.spec.ts', 'Old')]
      ),
      {}
    )
    expect(group.counts).toEqual({ passed: 1, failed: 0, skipped: 0, neverRun: 1 })
    expect(group.rows.map((row) => row.identity)).toEqual(['tests/tier-1/old.spec.ts|Old', 'new'])
  })
})
