import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
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
    lock?: (signal: AbortSignal) => Promise<() => void>
    prepare?: () => Promise<
      { cwd: string; cli: string; env: Record<string, string> } | { error: string }
    >
  } = {}
) {
  const children: FakeChild[] = []
  const specs: LaunchSpawnSpec[] = []
  const releases = vi.fn()
  const terminated: FakeChild[] = []
  let runId: string | null = null
  const launcher = new TestRunLauncher({
    dir,
    spawn: (spec) => {
      specs.push(spec)
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough()
      })
      children.push(child)
      return child
    },
    terminate: (child) => {
      terminated.push(children.find((entry) => entry === child) ?? children[0])
    },
    acquireLock: ({ signal }) => (options.lock ? options.lock(signal) : Promise.resolve(releases)),
    prepareSource: async () =>
      options.prepare
        ? options.prepare()
        : { cwd: '/src', cli: '/src/cli.js', env: { TEST_ENV: 'local' } },
    findRunByLaunch: () => runId,
    notify: () => undefined,
    createId: () => 'launch-1'
  })
  return {
    launcher,
    children,
    specs,
    releases,
    terminated,
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

  it('reports a source that cannot be prepared', async () => {
    const harness = createHarness({ prepare: async () => ({ error: 'No slot for tests' }) })
    harness.launcher.launch(REQUEST, { targetLabel: 'Kiosek' })
    await flush()
    expect(harness.launcher.list()[0]).toMatchObject({ state: 'error', error: 'No slot for tests' })
    expect(harness.releases).toHaveBeenCalledTimes(1)
    expect(harness.specs).toHaveLength(0)
  })
})
