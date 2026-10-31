import type { FeatureScope } from '../../../../shared/test-runs/test-catalog-types'
import { getRowFile, type TestRow } from './test-rows'

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
