/** Path of Orca's Playwright reporter, exported into every Orca terminal. */
export const ORCA_PLAYWRIGHT_REPORTER_ENV = 'ORCA_PLAYWRIGHT_REPORTER'
/** Directory the reporter writes runs into. */
export const ORCA_TEST_RUNS_DIR_ENV = 'ORCA_TEST_RUNS_DIR'
/** Path of Orca's run lock, which test repos put first in `globalSetup`. */
export const ORCA_PLAYWRIGHT_LOCK_ENV = 'ORCA_PLAYWRIGHT_LOCK'

export type TestRunTrigger = 'agent' | 'user' | 'orca'

export type TestRunStatus = 'running' | 'passed' | 'failed' | 'timedout' | 'interrupted'

export type TestResultStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'

export type TestAttachmentRecord = {
  name: string
  contentType: string
  /** Relative to the run directory. */
  file: string
}

export type TestRunRecord = {
  id: string
  status: TestRunStatus
  startedAt: number
  endedAt: number | null
  pid: number
  trigger: TestRunTrigger
  worktreeId: string | null
  /** Dev Environment the worktree belonged to when the run started. */
  devEnvId?: string | null
  /** Orca launch that started the run; absent for runs started in a terminal. */
  launchId?: string | null
  paneKey: string | null
  repo: { root: string; originUrl: string | null; commit: string | null; branch: string | null }
  /** Relative to the repo root. */
  configFile: string
  argv: string[]
  lane: string | null
  totals: { passed: number; failed: number; skipped: number; flaky: number }
}

export type TestResultRecord = {
  identity: string
  configFile: string
  project: string
  /** Relative to the repo root. */
  file: string
  line: number
  titlePath: string[]
  tags: string[]
  annotations: { type: string; description?: string }[]
  expectedStatus: TestResultStatus
  status: TestResultStatus
  outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped'
  retry: number
  isFinalAttempt: boolean
  durationMs: number
  error: { message: string; location: string | null } | null
  attachments: TestAttachmentRecord[]
  stdout: string
  stderr: string
}
