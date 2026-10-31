import type {
  TestRunSourceOption,
  TestRunTargetOption
} from '../../../../shared/test-runs/test-run-launch-types'
import type { TestRunSelection } from '../../../../shared/test-runs/test-run-launch-types'
import { getTestResultState, type TestResultEntry } from './test-results-grouping'
import { getRowFile, getRowLine, type TestRow } from './test-rows'

export function getSelectionForTests(entries: TestResultEntry[]): TestRunSelection {
  const locations = [
    ...new Set(entries.map((entry) => `${entry.result.file}:${entry.result.line}`))
  ]
  return { kind: 'tests', locations }
}

/** Picked rows: Playwright's listed location, else the last run's. */
export function getSelectionForRows(rows: TestRow[]): TestRunSelection {
  const locations = rows.flatMap((row) =>
    row.catalog || row.latest ? [`${getRowFile(row)}:${getRowLine(row)}`] : []
  )
  return { kind: 'tests', locations: [...new Set(locations)] }
}

export function getSelectionForFailed(entries: TestResultEntry[]): TestRunSelection {
  return getSelectionForTests(
    entries.filter((entry) => getTestResultState(entry.result) === 'failed')
  )
}

export function getSelectionForFolder(folder: string): TestRunSelection {
  return { kind: 'paths', paths: [folder.endsWith('/') ? folder : `${folder}/`] }
}

/** Playwright matches each path argument as a pattern, so a tier folder selects every suite's tier. */
export function getSelectionForTier(tier: number): TestRunSelection {
  return { kind: 'paths', paths: [`tier-${tier}/`] }
}

export function getDefaultTarget(
  targets: TestRunTargetOption[],
  devEnvId: string | null
): string | null {
  const own = targets.find(
    (option) => option.target.kind === 'dev-env' && option.target.devEnvId === devEnvId
  )
  return (own ?? targets[0])?.id ?? null
}

export function getDefaultSource(
  sources: TestRunSourceOption[],
  repoId: string | null,
  context: { isPreset: boolean; worktreeId: string | null } = { isPreset: false, worktreeId: null }
): string | null {
  // Why: a shared preset needs a worktree's own env files; origin/main has none.
  if (context.isPreset) {
    const worktrees = sources.filter((source) => source.kind === 'worktree')
    const preferred =
      worktrees.find((source) => source.id === `worktree:${context.worktreeId}`) ??
      worktrees.find((source) => source.repoId === repoId) ??
      worktrees[0]
    if (preferred) {
      return preferred.id
    }
  }
  const preferred =
    sources.find((source) => source.kind === 'origin-main' && source.repoId === repoId) ??
    sources.find((source) => source.kind === 'origin-main') ??
    sources[0]
  return preferred?.id ?? null
}
