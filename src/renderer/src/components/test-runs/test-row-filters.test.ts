import { describe, expect, it } from 'vitest'
import type { TestCatalogEntry } from '../../../../shared/test-runs/test-catalog-types'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { isFeatureRow } from './test-row-filters'
import type { TestRow } from './test-rows'

function catalogEntry(file: string, title: string, tags: string[] = []): TestCatalogEntry {
  return {
    identity: `${file}|${title}`,
    configFile: 'playwright.config.ts',
    project: 'chromium',
    file,
    line: 7,
    titlePath: [title],
    tags,
    annotations: [],
    isSerial: false
  }
}

function withResult(
  entry: TestCatalogEntry,
  run: Partial<TestRunRecord>,
  result: Partial<TestResultRecord> = {}
): TestRow {
  return {
    identity: entry.identity,
    catalog: entry,
    latest: {
      run: {
        id: 'r',
        status: 'passed',
        startedAt: 0,
        endedAt: 1,
        pid: 1,
        trigger: 'agent',
        worktreeId: 'w-feature',
        paneKey: null,
        repo: { root: '/w', originUrl: null, commit: null, branch: null },
        configFile: 'playwright.config.ts',
        argv: [],
        lane: null,
        totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 },
        ...run
      },
      result: {
        identity: entry.identity,
        configFile: 'playwright.config.ts',
        project: 'chromium',
        file: entry.file,
        line: entry.line,
        titlePath: entry.titlePath,
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
        ...result
      }
    }
  }
}

const row = (entry: TestCatalogEntry): TestRow => ({
  identity: entry.identity,
  catalog: entry,
  latest: null
})

describe('isFeatureRow', () => {
  const scope = { changedSpecFiles: ['tests/b.spec.ts'], since: 1000 }

  it('counts tests the branch changed', () => {
    expect(isFeatureRow(row(catalogEntry('tests/b.spec.ts', 'B')), scope, 'w-feature')).toBe(true)
    expect(isFeatureRow(row(catalogEntry('tests/a.spec.ts', 'A')), scope, 'w-feature')).toBe(false)
  })

  it('counts tests run against this workspace since the branch started', () => {
    expect(
      isFeatureRow(
        withResult(catalogEntry('tests/a.spec.ts', 'A'), { startedAt: 2000 }),
        scope,
        'w-feature'
      )
    ).toBe(true)
  })

  it('ignores runs from other workspaces and before the branch', () => {
    expect(
      isFeatureRow(
        withResult(catalogEntry('tests/a.spec.ts', 'A'), { startedAt: 500 }),
        scope,
        'w-feature'
      )
    ).toBe(false)
    expect(
      isFeatureRow(
        withResult(catalogEntry('tests/a.spec.ts', 'A'), {
          startedAt: 2000,
          worktreeId: 'w-other'
        }),
        scope,
        'w-feature'
      )
    ).toBe(false)
    expect(
      isFeatureRow(
        withResult(catalogEntry('tests/a.spec.ts', 'A'), { startedAt: 2000 }),
        { changedSpecFiles: [], since: null },
        'w-feature'
      )
    ).toBe(false)
  })
})
