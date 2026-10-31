import type { FeatureScope } from '../../../../shared/test-runs/test-catalog-types'
import { getTestTier } from '../../../../shared/test-runs/test-identity'
import { getTestResultState } from './test-results-grouping'
import { getRowFile, getRowTitlePath, type TestRow } from './test-rows'

/** Tests the branch added or changed, or ran against this workspace since the branch started. */
export function isFeatureRow(
  row: TestRow,
  scope: Pick<FeatureScope, 'changedSpecFiles' | 'since'>,
  worktreeId: string
): boolean {
  if (scope.changedSpecFiles.includes(getRowFile(row))) {
    return true
  }
  const run = row.latest?.run
  return Boolean(
    run && scope.since !== null && run.worktreeId === worktreeId && run.startedAt >= scope.since
  )
}

export type TestRowFilter = 'feature' | 'failed' | 'never-run' | 'all' | { tier: number }

function getSearchText(row: TestRow): string {
  const tags = [...(row.catalog?.tags ?? []), ...(row.latest?.result.tags ?? [])]
  return [getRowTitlePath(row).join(' '), getRowFile(row), ...tags].join(' ').toLowerCase()
}

function matchesFilter(
  row: TestRow,
  input: {
    filter: TestRowFilter
    feature: Pick<FeatureScope, 'changedSpecFiles' | 'since'>
    worktreeId: string
    tierPattern: RegExp
  }
): boolean {
  const { filter } = input
  if (filter === 'all') {
    return true
  }
  if (filter === 'feature') {
    return isFeatureRow(row, input.feature, input.worktreeId)
  }
  if (filter === 'failed') {
    return row.latest !== null && getTestResultState(row.latest.result) === 'failed'
  }
  if (filter === 'never-run') {
    return row.latest === null
  }
  return getTestTier(getRowFile(row), input.tierPattern) === filter.tier
}

/** Search terms (all must match title, file or a tag) on top of one filter. */
export function filterTestRows(
  rows: TestRow[],
  input: {
    query: string
    filter: TestRowFilter
    feature: Pick<FeatureScope, 'changedSpecFiles' | 'since'>
    worktreeId: string
    tierPattern: RegExp
  }
): TestRow[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter(
    (row) => matchesFilter(row, input) && terms.every((term) => getSearchText(row).includes(term))
  )
}
