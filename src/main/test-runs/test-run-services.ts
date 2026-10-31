import type { TestCatalog } from '../../shared/test-runs/test-catalog-types'
import type {
  TestRunLaunch,
  TestRunLaunchRequest,
  TestRunSourceOption,
  TestRunTargetOption
} from '../../shared/test-runs/test-run-launch-types'
import type { TestResultEntry } from './test-run-store'

/** What the desktop app's test runs offer to the CLI. */
export type TestRunServices = {
  listTargets: () => TestRunTargetOption[]
  listSources: () => Promise<TestRunSourceOption[]>
  getDevEnvIdForWorktree: (worktreeId: string) => string | null
  getLatestResults: (worktreeId: string) => TestResultEntry[]
  getCatalog: (targetId: string, sourceId: string, configFile: string) => Promise<TestCatalog>
  launch: (request: TestRunLaunchRequest) => TestRunLaunch | { error: string }
}

let services: TestRunServices | null = null

export function setTestRunServices(next: TestRunServices | null): void {
  services = next
}

export function getTestRunServices(): TestRunServices {
  if (!services) {
    throw new Error('Test runs need the Orca desktop app.')
  }
  return services
}

/** Same defaults as the Tests panel; a name or id picks explicitly. */
export function pickTestRunDefaults(input: {
  targets: TestRunTargetOption[]
  sources: TestRunSourceOption[]
  worktreeId: string
  devEnvId: string | null
  target?: string
  source?: string
}): { targetId: string | null; sourceId: string | null } {
  const target =
    input.targets.find((option) => option.id === input.target || option.label === input.target) ??
    input.targets.find(
      (option) => option.target.kind === 'dev-env' && option.target.devEnvId === input.devEnvId
    ) ??
    input.targets[0]
  const named = input.sources.find(
    (option) => option.id === input.source || option.label === input.source
  )
  const own = input.sources.find((option) => option.id === `worktree:${input.worktreeId}`)
  const fallback =
    target?.target.kind === 'preset'
      ? input.sources.find((option) => option.kind === 'worktree')
      : input.sources.find((option) => option.kind === 'origin-main')
  return {
    targetId: target?.id ?? null,
    sourceId: (named ?? own ?? fallback ?? input.sources[0])?.id ?? null
  }
}
