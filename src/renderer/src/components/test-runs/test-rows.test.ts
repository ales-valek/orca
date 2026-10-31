import { describe, expect, it } from 'vitest'
import type { TestCatalogEntry } from '../../../../shared/test-runs/test-catalog-types'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { buildTestRows, getRowLabels } from './test-rows'

const RUN: TestRunRecord = {
  id: 'r',
  status: 'passed',
  startedAt: 5,
  endedAt: 6,
  pid: 1,
  trigger: 'agent',
  worktreeId: 'w',
  paneKey: null,
  repo: { root: '/w', originUrl: null, commit: null, branch: null },
  configFile: 'playwright.config.ts',
  argv: [],
  lane: null,
  totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 }
}

function catalogEntry(
  identity: string,
  overrides: Partial<TestCatalogEntry> = {}
): TestCatalogEntry {
  return {
    identity,
    configFile: 'playwright.config.ts',
    project: 'chromium',
    file: `tests/${identity}.spec.ts`,
    line: 3,
    titlePath: [identity],
    tags: [],
    annotations: [],
    isSerial: false,
    ...overrides
  }
}

function result(identity: string, overrides: Partial<TestResultRecord> = {}) {
  return {
    run: RUN,
    result: {
      identity,
      configFile: 'playwright.config.ts',
      project: 'chromium',
      file: `tests/${identity}.spec.ts`,
      line: 3,
      titlePath: [identity],
      tags: [],
      annotations: [],
      expectedStatus: 'passed' as const,
      status: 'passed' as const,
      outcome: 'expected' as const,
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

describe('test rows', () => {
  it('merges catalog entries with their latest results by identity', () => {
    const rows = buildTestRows([catalogEntry('a'), catalogEntry('b')], [result('b')])
    expect(rows.map((row) => [row.identity, row.catalog !== null, row.latest !== null])).toEqual([
      ['a', true, false],
      ['b', true, true]
    ])
  })

  it('keeps results of tests no longer in the catalog', () => {
    const rows = buildTestRows([catalogEntry('a')], [result('gone')])
    expect(rows.map((row) => [row.identity, row.catalog !== null])).toEqual([
      ['a', true],
      ['gone', false]
    ])
  })

  it('labels serial, known bugs from repo settings and expected failures', () => {
    const [row] = buildTestRows(
      [
        catalogEntry('a', {
          isSerial: true,
          tags: ['@fast'],
          annotations: [{ type: 'fail' }, { type: 'issue', description: 'JIRA-9' }]
        })
      ],
      [result('a', { annotations: [{ type: 'bug-pin', description: 'CART-1' }] })]
    )
    expect(getRowLabels(row, { knownBugAnnotations: ['issue', 'bug-pin'] })).toEqual([
      { kind: 'known-bug', text: 'JIRA-9' },
      { kind: 'known-bug', text: 'CART-1' },
      { kind: 'expected-fail', text: '' },
      { kind: 'serial', text: '' },
      { kind: 'tag', text: '@fast' },
      { kind: 'project', text: 'chromium' }
    ])
  })
})
