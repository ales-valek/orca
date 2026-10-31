import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '@orca/process-host/process-tree-termination'
import type {
  TestRunLaunch,
  TestRunLaunchRequest,
  TestRunSelection
} from '../../shared/test-runs/test-run-launch-types'
import { getTargetLockKey } from './test-run-target-env'

export type LaunchSpawnSpec = {
  program: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: 'pipe'
  detached: boolean
}

/** A held run lock; the spawned run takes it over so it outlives Orca. */
export type TestRunLock = { release: () => void; setHolderPid: (pid: number) => void }

export type LaunchChild = {
  pid?: number
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
}

type PreparedSource = { cwd: string; cli: string; env: Record<string, string> }

type Holder = { pid: number; trigger: string; label: string }

const STOP_GRACE_MS = 5000
const MAX_LAUNCHES = 20
const LOG_TAIL_BYTES = 64 * 1024

export function buildPlaywrightArgs(input: {
  cli: string
  configFile: string
  selection: TestRunSelection
  headed: boolean
}): string[] {
  const filters =
    input.selection.kind === 'tests'
      ? input.selection.locations
      : input.selection.kind === 'paths'
        ? input.selection.paths
        : []
  return [
    input.cli,
    'test',
    '-c',
    input.configFile,
    ...filters,
    ...(input.headed ? ['--headed'] : [])
  ]
}

function getLaunchTitle(selection: TestRunSelection, headed: boolean): string {
  const title =
    selection.kind === 'tests'
      ? `${selection.locations.length} ${selection.locations.length === 1 ? 'test' : 'tests'}`
      : selection.kind === 'paths'
        ? selection.paths.join(', ')
        : 'All tests'
  return headed ? `${title} · headed` : title
}

function terminateTree(child: LaunchChild): void {
  // SAFETY: launches always come from spawnProcess, which returns a ChildProcess.
  const tree = child as ChildProcess
  void signalProcessTree(tree, 'SIGTERM')
  setTimeout(() => void forceTerminateProcessTree(tree), STOP_GRACE_MS).unref?.()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Runs a Playwright selection against a target; one run per target, agent runs included. */
export class TestRunLauncher {
  private readonly launches: TestRunLaunch[] = []
  private readonly controllers = new Map<string, AbortController>()
  private readonly children = new Map<string, LaunchChild>()

  constructor(
    private readonly deps: {
      dir: string
      spawn?: (spec: LaunchSpawnSpec) => LaunchChild
      terminate?: (child: LaunchChild) => void
      acquireLock: (input: {
        key: string
        holder: Holder
        signal: AbortSignal
      }) => Promise<TestRunLock>
      prepareSource: (
        request: TestRunLaunchRequest,
        signal: AbortSignal,
        logPath: string
      ) => Promise<PreparedSource | { error: string }>
      findRunByLaunch: (launchId: string) => string | null
      notify: () => void
      now?: () => number
      createId?: () => string
    }
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private getLogPath(id: string): string {
    return join(this.deps.dir, 'launches', `${id}.log`)
  }

  private update(id: string, changes: Partial<TestRunLaunch>): void {
    const index = this.launches.findIndex((launch) => launch.id === id)
    if (index !== -1) {
      this.launches[index] = { ...this.launches[index], ...changes }
      this.deps.notify()
    }
  }

  private get(id: string): TestRunLaunch | undefined {
    return this.launches.find((launch) => launch.id === id)
  }

  launch(request: TestRunLaunchRequest, labels: { targetLabel: string }): TestRunLaunch {
    const id = (this.deps.createId ?? randomUUID)()
    const launch: TestRunLaunch = {
      id,
      state: 'queued',
      title: getLaunchTitle(request.selection, request.headed),
      targetLabel: labels.targetLabel,
      worktreeId: request.worktreeId,
      startedAt: this.now(),
      endedAt: null,
      runId: null,
      error: null
    }
    this.launches.unshift(launch)
    this.launches.splice(MAX_LAUNCHES)
    mkdirSync(join(this.deps.dir, 'launches'), { recursive: true })
    const controller = new AbortController()
    this.controllers.set(id, controller)
    void this.run(id, request, labels.targetLabel, controller.signal)
    this.deps.notify()
    return launch
  }

  private async run(
    id: string,
    request: TestRunLaunchRequest,
    targetLabel: string,
    signal: AbortSignal
  ): Promise<void> {
    const lockTarget = getTargetLockKey(request.target)
    let lock: TestRunLock | null = null
    try {
      // Why the whole target: an Orca run has no lane, so it may touch every lane's data.
      lock = await this.deps.acquireLock({
        key: `${lockTarget}#`,
        holder: { pid: process.pid, trigger: 'orca', label: targetLabel },
        signal
      })
      this.update(id, { state: 'preparing' })
      const logPath = this.getLogPath(id)
      const prepared = await this.deps.prepareSource(request, signal, logPath)
      if (signal.aborted) {
        this.finish(id, 'stopped')
        return
      }
      if ('error' in prepared) {
        this.finish(id, 'error', prepared.error)
        return
      }
      const code = await this.spawnRun(id, request, prepared, lockTarget, logPath, lock)
      this.finish(id, signal.aborted ? 'stopped' : code === 0 ? 'passed' : 'failed')
    } catch (error) {
      if (isAbortError(error)) {
        this.finish(id, 'stopped')
      } else {
        this.finish(id, 'error', error instanceof Error ? error.message : String(error))
      }
    } finally {
      lock?.release()
      this.controllers.delete(id)
      this.children.delete(id)
    }
  }

  private spawnRun(
    id: string,
    request: TestRunLaunchRequest,
    prepared: PreparedSource,
    lockTarget: string,
    logPath: string,
    lock: TestRunLock
  ): Promise<number | null> {
    const spawn = this.deps.spawn ?? spawnProcess
    const child = spawn({
      program: process.execPath,
      args: buildPlaywrightArgs({
        cli: prepared.cli,
        configFile: request.configFile,
        selection: request.selection,
        headed: request.headed
      }),
      cwd: prepared.cwd,
      env: {
        ...process.env,
        ...prepared.env,
        // Why: Orca's own binary runs the repo's Playwright as plain Node.
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_TEST_RUN_TRIGGER: 'orca',
        ORCA_TEST_LAUNCH_ID: id,
        ORCA_TEST_LOCK_KEY: lockTarget,
        // Why: this launcher already holds the lock the run's global setup would take.
        ORCA_TEST_LOCK_HELD: '1',
        ...(request.worktreeId ? { ORCA_WORKTREE_ID: request.worktreeId } : {})
      },
      stdio: 'pipe',
      detached: process.platform !== 'win32'
    })
    this.children.set(id, child)
    // Why: if Orca dies mid-run, the detached run keeps going and must keep the lock.
    if (child.pid) {
      lock.setHolderPid(child.pid)
    }
    const onOutput = (chunk: Buffer | string): void => {
      appendFileSync(logPath, chunk)
      if (this.get(id)?.state === 'preparing') {
        const runId = this.deps.findRunByLaunch(id)
        if (runId) {
          this.update(id, { state: 'running', runId })
        }
      }
    }
    child.stdout?.on('data', onOutput)
    child.stderr?.on('data', onOutput)
    return new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code))
    })
  }

  private finish(id: string, state: TestRunLaunch['state'], error: string | null = null): void {
    const runId = this.get(id)?.runId ?? this.deps.findRunByLaunch(id)
    this.update(id, { state, error, endedAt: this.now(), runId })
  }

  stop(id: string): void {
    this.controllers.get(id)?.abort()
    const child = this.children.get(id)
    if (child) {
      ;(this.deps.terminate ?? terminateTree)(child)
    }
  }

  stopAll(): void {
    for (const id of this.controllers.keys()) {
      this.stop(id)
    }
  }

  list(): TestRunLaunch[] {
    return [...this.launches]
  }

  readLog(id: string): string {
    const path = this.getLogPath(id)
    try {
      const size = statSync(path).size
      const text = readFileSync(path, 'utf8')
      return size > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text
    } catch {
      return ''
    }
  }
}
