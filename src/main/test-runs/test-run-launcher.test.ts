import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestRunLaunchRequest } from '../../shared/test-runs/test-run-launch-types'
import {
  TestRunLauncher,
  buildPlaywrightArgs,
  type LaunchChild,
  type LaunchSpawnSpec
} from './test-run-launcher'

type FakeChild = LaunchChild & EventEmitter & { stdout: PassThrough; stderr: PassThrough }

const REQUEST: TestRunLaunchRequest = {
  target: { kind: 'dev-env', devEnvId: 'kiosek' },
  sourceId: 'origin-main:r-tests',
  configFile: 'playwright.config.ts',
  selection: { kind: 'tests', locations: ['tests/a.spec.ts:12'] },
  headed: false,
  worktreeId: 'w-eshop'
}

let dir: string

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function createHarness(
  options: {
    lock?: (
      signal: AbortSignal,
      onWait: (holder: { pid: number; trigger: string; label: string }) => void
    ) => Promise<{ release: () => void; setHolderPid: (pid: number) => void }>
    prepare?: () => Promise<
      { cwd: string; cli: string; env: Record<string, string> } | { error: string }
    >
  } = {}
) {
  const children: FakeChild[] = []
  const specs: LaunchSpawnSpec[] = []
  const releases = vi.fn()
  const holderPids: number[] = []
  const terminated: FakeChild[] = []
  let runId: string | null = null
  let runLookups = 0
  let nextId = 0
  const launcher = new TestRunLauncher({
    dir,
    spawn: (spec) => {
      specs.push(spec)
      const child = Object.assign(new EventEmitter(), {
        pid: 4242,
        stdout: new PassThrough(),
        stderr: new PassThrough()
      })
      children.push(child)
      return child
    },
    terminate: (child) => {
      terminated.push(children.find((entry) => entry === child) ?? children[0])
    },
    acquireLock: ({ signal, onWait }) =>
      options.lock
        ? options.lock(signal, onWait)
        : Promise.resolve({
            release: releases,
            setHolderPid: (pid: number) => holderPids.push(pid)
          }),
    prepareSource: async () =>
      options.prepare
        ? options.prepare()
        : { cwd: '/src', cli: '/src/cli.js', env: { TEST_ENV: 'local' } },
    findRunByLaunch: () => {
      runLookups++
      return runId
    },
    notify: () => undefined,
    now: () => 1000,
    createId: () => (nextId++ === 0 ? 'launch-1' : `launch-${nextId}`)
  })
  return {
    launcher,
    children,
    specs,
    releases,
    holderPids,
    terminated,
    runLookups: () => runLookups,
    setRunId: (id: string) => {
      runId = id
    }
  }
}

describe('TestRunLauncher', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-run-launcher-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('builds Playwright arguments for tests, paths, all and headed', () => {
    const base = { cli: '/c/cli.js', configFile: 'playwright.config.ts', headed: false }
    expect(
      buildPlaywrightArgs({ ...base, selection: { kind: 'tests', locations: ['a.spec.ts:3'] } })
    ).toEqual(['/c/cli.js', 'test', '-c', 'playwright.config.ts', 'a.spec.ts:3'])
    expect(
      buildPlaywrightArgs({
        ...base,
        selection: { kind: 'paths', paths: ['tier-1/'] },
        headed: true
      })
    ).toEqual(['/c/cli.js', 'test', '-c', 'playwright.config.ts', 'tier-1/', '--headed'])
    expect(buildPlaywrightArgs({ ...base, selection: { kind: 'all' } })).toEqual([
      '/c/cli.js',
      'test',
      '-c',
      'playwright.config.ts'
    ])
  })

  it('runs a launch through queued, preparing, running and passed', async () => {
    const harness = createHarness()
    const launch = harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    expect(launch).toMatchObject({
      id: 'launch-1',
      state: 'queued',
      title: '1 test',
      targetLabel: 'Kiosek'
    })
    await flush()
    expect(harness.launcher.list()[0].state).toBe('preparing')
    expect(harness.specs[0]).toMatchObject({
      cwd: '/src',
      args: ['/src/cli.js', 'test', '-c', 'playwright.config.ts', 'tests/a.spec.ts:12']
    })
    expect(harness.specs[0].env).toMatchObject({
      TEST_ENV: 'local',
      ORCA_TEST_RUN_TRIGGER: 'orca',
      ORCA_TEST_LAUNCH_ID: 'launch-1',
      ORCA_TEST_LOCK_KEY: 'dev-env:kiosek',
      ORCA_TEST_LOCK_HELD: '1',
      ORCA_WORKTREE_ID: 'w-eshop',
      ELECTRON_RUN_AS_NODE: '1'
    })
    harness.setRunId('run-1')
    harness.children[0].stdout.write('Running 1 test\n')
    await flush()
    expect(harness.launcher.list()[0]).toMatchObject({ state: 'running', runId: 'run-1' })
    expect(harness.launcher.readLog('launch-1')).toContain('Running 1 test')
    harness.children[0].emit('exit', 0)
    await flush()
    expect(harness.launcher.list()[0]).toMatchObject({
      state: 'passed',
      endedAt: expect.any(Number)
    })
    expect(harness.releases).toHaveBeenCalledTimes(1)
  })

  it('hands the lock to the spawned run, so it stays held if Orca dies', async () => {
    const harness = createHarness()
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    expect(harness.holderPids).toEqual([4242])
  })

  it('marks a failing exit as failed and releases the lock', async () => {
    const harness = createHarness()
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    harness.children[0].emit('exit', 1)
    await flush()
    expect(harness.launcher.list()[0].state).toBe('failed')
    expect(harness.releases).toHaveBeenCalledTimes(1)
  })

  it('stopping a queued launch never starts it', async () => {
    const harness = createHarness({
      lock: (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('stop'), { name: 'AbortError' }))
          )
        )
    })
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    harness.launcher.stop('launch-1')
    await flush()
    expect(harness.launcher.list()[0].state).toBe('stopped')
    expect(harness.specs).toHaveLength(0)
  })

  it('stopping a running launch terminates its process', async () => {
    const harness = createHarness()
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    harness.launcher.stop('launch-1')
    expect(harness.terminated).toHaveLength(1)
    harness.children[0].emit('exit', null)
    await flush()
    expect(harness.launcher.list()[0].state).toBe('stopped')
    expect(harness.releases).toHaveBeenCalledTimes(1)
  })

  it('names who holds the environment while it waits', async () => {
    const harness = createHarness({
      lock: (_signal, onWait) => {
        onWait({ pid: 77, trigger: 'agent', label: 'dev-env:kiosek#eshop' })
        return new Promise(() => undefined)
      }
    })
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    expect(harness.launcher.list()[0]).toMatchObject({
      state: 'queued',
      waitingFor: { trigger: 'agent', pid: 77 }
    })
  })

  it('shows a stop during preparation as stopped, not as a failure', async () => {
    let launcher: TestRunLauncher | null = null
    const harness = createHarness({
      prepare: async () => {
        launcher?.stop('launch-1')
        throw new Error('pnpm install failed')
      }
    })
    launcher = harness.launcher
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    expect(harness.launcher.list()[0].state).toBe('stopped')
  })

  it('looks for the run at most once a second while output streams', async () => {
    const harness = createHarness()
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    for (let index = 0; index < 20; index++) {
      harness.children[0].stdout.write(`line ${index}\n`)
    }
    await flush()
    expect(harness.runLookups()).toBeLessThanOrEqual(1)
  })

  it('keeps every active launch when trimming the list', async () => {
    const harness = createHarness({ lock: () => new Promise(() => undefined) })
    for (let index = 0; index < 25; index++) {
      harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    }
    await flush()
    expect(harness.launcher.list()).toHaveLength(25)
  })

  it('removes launch logs older than a week', () => {
    mkdirSync(join(dir, 'launches'), { recursive: true })
    const old = join(dir, 'launches', 'old.log')
    writeFileSync(old, 'x')
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(old, weekAgo, weekAgo)
    createHarness()
    expect(existsSync(old)).toBe(false)
  })

  it("does not hand Orca's own workspace to a launch without one", async () => {
    vi.stubEnv('ORCA_WORKTREE_ID', 'w-orca')
    vi.stubEnv('ORCA_PANE_KEY', 'pane-orca')
    const harness = createHarness()
    harness.launcher.launch({ ...REQUEST, worktreeId: null }, { targetLabel: 'dev' })
    await flush()
    expect(harness.specs[0].env.ORCA_WORKTREE_ID).toBeUndefined()
    expect(harness.specs[0].env.ORCA_PANE_KEY).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('reports a source that cannot be prepared', async () => {
    const harness = createHarness({ prepare: async () => ({ error: 'No slot for tests' }) })
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    expect(harness.launcher.list()[0]).toMatchObject({ state: 'error', error: 'No slot for tests' })
    expect(harness.releases).toHaveBeenCalledTimes(1)
    expect(harness.specs).toHaveLength(0)
  })
})
