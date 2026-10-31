import type {
  TestRunLaunch,
  TestRunLaunchRequest,
  TestRunTarget
} from '../../shared/test-runs/test-run-launch-types'
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
}

export type TestRunTargetOption = {
  id: string
  target: TestRunTarget
  label: string
  /** Shared presets: the lock only coordinates this machine's runs. */
  isShared: boolean
}

export type TestRunSourceOption = {
  id: string
  kind: 'origin-main' | 'worktree'
  repoId: string
  label: string
  configFiles: string[]
}
