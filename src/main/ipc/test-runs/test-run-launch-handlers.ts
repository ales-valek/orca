import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { app, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type {
  TestRunLaunch,
  TestRunTarget,
  TestRunTargetOption
} from '../../../shared/test-runs/test-run-launch-types'
import { composeWorktreeId } from '../../../shared/worktree/id'
import { listWorktrees } from '../../git/worktree-scan-cache'
import type { Store } from '../../persistence'
import { applyTestRunsEnv } from '../pty/host-env/test-runs-env'
import { TestRunCheckouts } from '../../test-runs/test-run-checkouts'
import { TestRunLauncher } from '../../test-runs/test-run-launcher'
import {
  findPlaywrightCli,
  findPlaywrightConfigs,
  listTestRunSources,
  type TestRunSource
} from '../../test-runs/test-run-sources'
import type { TestRunStore } from '../../test-runs/test-run-store'
import {
  getCheckoutKey,
  getSourceTargetError,
  getTargetEnv,
  getTargetLockKey
} from '../../test-runs/test-run-target-env'

// Why no leading dash: each entry reaches Playwright's CLI as an argument, never as an option.
const SelectionEntry = z.string().regex(/^[^-]/, 'Selections are file paths or file:line')
const TargetArgs = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dev-env'), devEnvId: z.string().min(1) }),
  z.object({ kind: z.literal('preset'), name: z.string().min(1) })
])
const LaunchArgs = z.object({
  target: TargetArgs,
  sourceId: z.string().min(1),
  configFile: z.string().regex(/^playwright(\.[\w-]+)?\.config\.(ts|js|mjs|cjs)$/),
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tests'), locations: z.array(SelectionEntry).min(1) }),
    z.object({ kind: z.literal('paths'), paths: z.array(SelectionEntry).min(1) }),
    z.object({ kind: z.literal('all') })
  ]),
  headed: z.boolean(),
  worktreeId: z.string().nullable()
})
const LaunchIdArgs = z.object({ id: z.string().min(1) })

type LockModule = {
  acquireLock: (input: {
    dir: string
    key: string
    holder: { pid: number; trigger: string; label: string }
    signal?: AbortSignal
    onWait?: (holder: { pid: number; trigger: string; label: string }) => void
  }) => Promise<(() => void) & { setHolderPid: (pid: number) => void }>
}

type SourceView = TestRunSource & { id: string; path: string; configFiles: string[] }

/** Checkout, env files and Playwright CLI of a source for a target; shared by launches and lists. */
export type PrepareTestSource = (
  request: { target: TestRunTarget; sourceId: string },
  signal: AbortSignal | undefined,
  logPath: string,
  options?: { reuseCheckout?: boolean }
) => Promise<{ cwd: string; cli: string; env: Record<string, string> } | { error: string }>

function getSourceId(source: TestRunSource): string {
  return source.kind === 'origin-main'
    ? `origin-main:${source.repoId}`
    : `worktree:${source.worktreeId}`
}

function getSourceDir(source: TestRunSource): string {
  return source.kind === 'origin-main' ? source.repoPath : source.path
}

/** Starting Playwright runs from Orca: targets, sources and launches. */
export function createTestRunLaunchHandlers(deps: {
  store: Store
  runs: TestRunStore
  dir: string
  lockPath: string
  notify: () => void
  renderSlotEnvFilesInto: (
    envId: string,
    repoId: string,
    dir: string
  ) => Promise<{ ok: true; install: string[] } | { error: string }>
}): {
  handlers: Record<string, (event: IpcMainInvokeEvent, args: unknown) => unknown>
  stop: () => void
  launch: (request: unknown) => TestRunLaunch | { error: string }
  listTargets: () => TestRunTargetOption[]
  listSources: () => Promise<SourceView[]>
  prepareTestSource: PrepareTestSource
} {
  const { store, runs, dir } = deps
  // Why require: the launcher and terminal runs must share one lock implementation.
  const lock: LockModule = createRequire(__filename)(deps.lockPath)
  const checkouts = new TestRunCheckouts({ dir })
  // Why at start: a deleted environment's checkout (with its node_modules) is dead weight.
  try {
    const keep = new Set(
      store
        .getRepos()
        .flatMap((repo) =>
          store
            .getDevEnvs()
            .map((env) => getCheckoutKey(repo.id, { kind: 'dev-env', devEnvId: env.id }))
        )
    )
    checkouts.removeUnused(keep)
  } catch (error) {
    console.error('[test-runs] cannot remove unused checkouts', error)
  }

  const listTargets = (): TestRunTargetOption[] => [
    ...store.getDevEnvs().map((env) => ({
      id: `dev-env:${env.id}`,
      target: { kind: 'dev-env' as const, devEnvId: env.id },
      label: env.name,
      isShared: false
    })),
    ...store.getSettings().devEnvTestRuns.presets.map((preset) => ({
      id: `preset:${preset.name}`,
      target: { kind: 'preset' as const, name: preset.name },
      label: preset.name,
      isShared: true
    }))
  ]

  const listSources = async (): Promise<SourceView[]> => {
    const repos = store
      .getRepos()
      .filter((repo) => !repo.connectionId && findPlaywrightConfigs(repo.path).length > 0)
    const worktrees = (
      await Promise.all(
        repos.map(async (repo) =>
          (await listWorktrees(repo.path)).map((worktree) => ({
            id: composeWorktreeId(repo.id, worktree.path),
            repoId: repo.id,
            path: worktree.path,
            label: worktree.branch.replace(/^refs\/heads\//, '') || basename(worktree.path)
          }))
        )
      )
    ).flat()
    return listTestRunSources({
      repos: repos.map((repo) => ({ id: repo.id, path: repo.path, name: repo.displayName })),
      worktrees
    }).map((source) => ({
      ...source,
      id: getSourceId(source),
      path: getSourceDir(source),
      configFiles: findPlaywrightConfigs(getSourceDir(source))
    }))
  }

  const prepareTestSource: PrepareTestSource = async (request, signal, logPath, options = {}) => {
    const settings = store.getSettings()
    const targetEnv = getTargetEnv(request.target, settings.devEnvTestRuns)
    if ('error' in targetEnv) {
      return targetEnv
    }
    const source = (await listSources()).find((entry) => entry.id === request.sourceId)
    if (!source) {
      return { error: 'This test source is no longer available.' }
    }
    const mismatch = getSourceTargetError({
      sourceWorktreeId: source.kind === 'worktree' ? source.worktreeId : null,
      target: request.target,
      envs: store.getDevEnvs()
    })
    if (mismatch) {
      return { error: mismatch }
    }
    let cwd = getSourceDir(source)
    if (source.kind === 'origin-main') {
      if (request.target.kind !== 'dev-env') {
        return {
          error: 'Presets run from a worktree of the test repo, which has its own env files.'
        }
      }
      const env = store.getDevEnv(request.target.devEnvId)
      const template = settings.devEnvTemplates.find((entry) => entry.id === env?.templateId)
      const slot = template?.slots.find((entry) => entry.repoId === source.repoId)
      if (!env || !slot) {
        return {
          error: `The template of ${env?.name ?? 'this environment'} has no slot for ${source.label}. Add one so Orca can prepare the tests.`
        }
      }
      const key = getCheckoutKey(source.repoId, request.target)
      // Why reuse: listing must not reset a checkout a run may be using right now.
      if (options.reuseCheckout && checkouts.exists(key)) {
        cwd = checkouts.getPath(key)
      } else {
        cwd = (
          await checkouts.prepare({
            key,
            repoPath: source.repoPath,
            install: slot.install,
            logPath,
            signal
          })
        ).path
        const rendered = await deps.renderSlotEnvFilesInto(env.id, source.repoId, cwd)
        if ('error' in rendered) {
          return rendered
        }
      }
    }
    const cli = findPlaywrightCli(cwd)
    if (!cli) {
      return { error: `Playwright is not installed in ${cwd}` }
    }
    const env: Record<string, string> = {}
    applyTestRunsEnv(env, { userDataPath: app.getPath('userData'), isWsl: false })
    return { cwd, cli, env: { ...env, ...targetEnv.env } }
  }

  const launchRequest = (raw: unknown): TestRunLaunch | { error: string } => {
    const request = LaunchArgs.parse(raw)
    const target = listTargets().find(
      (entry) => getTargetLockKey(entry.target) === getTargetLockKey(request.target)
    )
    return target
      ? launcher.launch(request, { targetLabel: target.label })
      : { error: 'This target no longer exists.' }
  }

  const launcher = new TestRunLauncher({
    dir,
    acquireLock: async ({ key, holder, signal, onWait }) => {
      const release = await lock.acquireLock({ dir, key, holder, signal, onWait })
      return { release, setHolderPid: release.setHolderPid }
    },
    findRunByLaunch: (launchId) =>
      runs.listRuns().find((run) => run.launchId === launchId)?.id ?? null,
    notify: deps.notify,
    prepareSource: (request, signal, logPath) => prepareTestSource(request, signal, logPath)
  })

  return {
    handlers: {
      'testRuns:listTargets': () => listTargets(),
      'testRuns:listSources': () => listSources(),
      'testRuns:launch': (_event, raw) => launchRequest(raw),
      'testRuns:stopLaunch': (_event, raw) => launcher.stop(LaunchIdArgs.parse(raw).id),
      'testRuns:listLaunches': () => launcher.list(),
      'testRuns:readLaunchLog': (_event, raw) => launcher.readLog(LaunchIdArgs.parse(raw).id)
    },
    stop: () => launcher.stopAll(),
    launch: launchRequest,
    listTargets,
    listSources,
    prepareTestSource
  }
}
