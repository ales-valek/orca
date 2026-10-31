import type {
  TestRunLaunch,
  TestRunLaunchRequest,
  TestRunSourceOption,
  TestRunTargetOption
} from '../../shared/test-runs/test-run-launch-types'
import type { FeatureScope, TestCatalog } from '../../shared/test-runs/test-catalog-types'
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
  listTargets: () => Promise<TestRunTargetOption[]>
  listSources: () => Promise<TestRunSourceOption[]>
  launch: (request: TestRunLaunchRequest) => Promise<TestRunLaunch | { error: string }>
  stopLaunch: (args: { id: string }) => Promise<void>
  listLaunches: () => Promise<TestRunLaunch[]>
  readLaunchLog: (args: { id: string }) => Promise<string>
  onLaunchesChanged: (callback: () => void) => () => void
  getCatalog: (args: {
    targetId: string
    sourceId: string
    configFile: string
  }) => Promise<TestCatalog>
  getFeatureScope: (args: { sourceId: string }) => Promise<FeatureScope>
}
