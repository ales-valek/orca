import { getTestTier } from '../../../../shared/test-runs/test-identity'
import type { TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import {
  getTestResultState,
  type TestResultCounts,
  type TestResultEntry
} from './test-results-grouping'

export type TierSummary = TestResultCounts & { tier: number | null; lastRunAt: number | null }

export type WorkspaceSummary = { worktreeId: string; lastRun: TestRunRecord; failedTests: number }

/** Per tier folder; tests outside tier folders come last. */
export function summarizeRepoTiers(
  entries: TestResultEntry[],
  options: { tierPattern?: RegExp }
): TierSummary[] {
  const byTier = new Map<number | null, TierSummary>()
  for (const entry of entries) {
    const tier = getTestTier(entry.result.file, options.tierPattern)
    const summary = byTier.get(tier) ?? { tier, passed: 0, failed: 0, skipped: 0, lastRunAt: null }
    summary[getTestResultState(entry.result)]++
    summary.lastRunAt = Math.max(summary.lastRunAt ?? 0, entry.run.startedAt)
    byTier.set(tier, summary)
  }
  return [...byTier.values()].toSorted(
    (a, b) => (a.tier ?? Number.POSITIVE_INFINITY) - (b.tier ?? Number.POSITIVE_INFINITY)
  )
}

/** Newest run per workspace, newest workspace first. */
export function summarizeWorkspaces(runs: TestRunRecord[]): WorkspaceSummary[] {
  const byWorkspace = new Map<string, TestRunRecord>()
  for (const run of runs) {
    const current = run.worktreeId ? byWorkspace.get(run.worktreeId) : undefined
    if (run.worktreeId && (!current || current.startedAt < run.startedAt)) {
      byWorkspace.set(run.worktreeId, run)
    }
  }
  return [...byWorkspace.entries()]
    .map(([worktreeId, lastRun]) => ({ worktreeId, lastRun, failedTests: lastRun.totals.failed }))
    .toSorted((a, b) => b.lastRun.startedAt - a.lastRun.startedAt)
}
