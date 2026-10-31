/** What a run is pointed at: a local Dev Environment, or a named shared preset. */
export type TestRunTarget = { kind: 'dev-env'; devEnvId: string } | { kind: 'preset'; name: string }

export type TestRunSelection =
  /** `file:line` locations, e.g. `tests/eshop/tier-1/cart.spec.ts:12`. */
  | { kind: 'tests'; locations: string[] }
  /** Folders or tier folders; Playwright treats each argument as a path pattern. */
  | { kind: 'paths'; paths: string[] }
  | { kind: 'all' }

export type TestRunLaunchRequest = {
  target: TestRunTarget
  /** `origin-main:<repoId>` or `worktree:<worktreeId>`. */
  sourceId: string
  configFile: string
  selection: TestRunSelection
  headed: boolean
  /** Workspace whose Tests panel lists the run. */
  worktreeId: string | null
}

export type TestRunLaunchState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'passed'
  | 'failed'
  | 'stopped'
  | 'error'

export type TestRunLaunch = {
  id: string
  state: TestRunLaunchState
  title: string
  targetLabel: string
  worktreeId: string | null
  startedAt: number
  endedAt: number | null
  runId: string | null
  error: string | null
  /** While queued: the run that holds the environment. */
  waitingFor?: { trigger: string; pid: number } | null
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
  /** Repo path for origin/main, worktree path otherwise. */
  path: string
  label: string
  configFiles: string[]
}

/** Why not `'error' in value`: a started launch has an `error` field too. */
export function isTestRunLaunch(value: TestRunLaunch | { error: string }): value is TestRunLaunch {
  return 'id' in value
}
