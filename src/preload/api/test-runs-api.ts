import type { TestResultRecord, TestRunRecord } from '../../shared/test-runs/test-run-types'

type TestRunFilterArgs = { worktreeId?: string; repoKey?: string; limit?: number }
type ArtifactArgs = { runId: string; file: string }
type TestResultEntry = { result: TestResultRecord; run: TestRunRecord }

export type TestRunsApi = {
  listRuns: (args: TestRunFilterArgs) => Promise<TestRunRecord[]>
  getLatestResults: (args: Omit<TestRunFilterArgs, 'limit'>) => Promise<TestResultEntry[]>
  getHistory: (args: { identity: string }) => Promise<TestResultEntry[]>
  getArtifactUrl: (args: ArtifactArgs) => Promise<{ url: string } | { error: string }>
  openTrace: (args: ArtifactArgs) => Promise<{ url: string } | { error: string }>
  onChanged: (callback: () => void) => () => void
}
