import { describe, expect, it } from 'vitest'
import type { TestCatalogEntry } from '../../../../shared/test-runs/test-catalog-types'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { filterTestRows, isFeatureRow } from './test-row-filters'
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

describe('filterTestRows', () => {
  const rows: TestRow[] = [
    row(
      catalogEntry('tests/eshop/tier-1/esh-cart-07.spec.ts', 'ESH-CART-07 — Upsell modal', [
        '@serial'
      ])
    ),
    withResult(
      catalogEntry('tests/eshop/tier-3/esh-chk-03.spec.ts', 'ESH-CHK-03 Checkout total'),
      {},
      {
        status: 'failed',
        outcome: 'unexpected'
      }
    ),
    withResult(catalogEntry('tests/admin/tier-1/adm-inv-05.spec.ts', 'ADM-INV-05 Stock export'), {})
  ]
  const base = {
    query: '',
    filter: 'all' as const,
    feature: { changedSpecFiles: [], since: null },
    worktreeId: 'w-feature',
    tierPattern: /(?:^|\/)tier-(\d+)\//
  }
  const titles = (result: TestRow[]): string[] =>
    result.map((entry) => entry.catalog?.titlePath[0] ?? '')

  it('matches ids, titles, files and tags', () => {
    expect(titles(filterTestRows(rows, { ...base, query: 'esh-cart-0' }))).toEqual([
      'ESH-CART-07 — Upsell modal'
    ])
    expect(titles(filterTestRows(rows, { ...base, query: 'stock' }))).toEqual([
      'ADM-INV-05 Stock export'
    ])
    expect(titles(filterTestRows(rows, { ...base, query: 'tests/admin' }))).toEqual([
      'ADM-INV-05 Stock export'
    ])
    expect(titles(filterTestRows(rows, { ...base, query: '@serial' }))).toEqual([
      'ESH-CART-07 — Upsell modal'
    ])
  })

  it('requires every term', () => {
    expect(titles(filterTestRows(rows, { ...base, query: 'esh checkout' }))).toEqual([
      'ESH-CHK-03 Checkout total'
    ])
  })

  it('filters failed, never run and a tier', () => {
    expect(titles(filterTestRows(rows, { ...base, filter: 'failed' }))).toEqual([
      'ESH-CHK-03 Checkout total'
    ])
    expect(titles(filterTestRows(rows, { ...base, filter: 'never-run' }))).toEqual([
      'ESH-CART-07 — Upsell modal'
    ])
    expect(titles(filterTestRows(rows, { ...base, filter: { tier: 1 } }))).toEqual([
      'ESH-CART-07 — Upsell modal',
      'ADM-INV-05 Stock export'
    ])
  })
})
