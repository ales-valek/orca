import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestResultRecord, TestRunRecord } from '../../shared/test-runs/test-run-types'
import { TestRunStore } from './test-run-store'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

let dir: string

function makeRun(id: string, overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    id,
    status: 'passed',
    startedAt: NOW - DAY,
    endedAt: NOW - DAY + 1000,
    pid: 4242,
    trigger: 'user',
    worktreeId: 'repo::/w/main',
    paneKey: null,
    repo: {
      root: '/w/main',
      originUrl: 'git@github.com:o/tests.git',
      commit: 'abc',
      branch: 'main'
    },
    configFile: 'playwright.config.ts',
    argv: [],
    lane: null,
    totals: { passed: 1, failed: 0, skipped: 0, flaky: 0 },
    ...overrides
  }
}

function makeResult(identity: string, overrides: Partial<TestResultRecord> = {}): TestResultRecord {
  return {
    identity,
    configFile: 'playwright.config.ts',
    project: 'chromium',
    file: 'tests/tier-1/a.spec.ts',
    line: 1,
    titlePath: [identity],
    tags: [],
    annotations: [],
    expectedStatus: 'passed',
    status: 'passed',
    outcome: 'expected',
    retry: 0,
    isFinalAttempt: true,
    durationMs: 10,
    error: null,
    attachments: [],
    stdout: '',
    stderr: '',
    ...overrides
  }
}

function writeRun(run: TestRunRecord, results: TestResultRecord[], bytes = 0): void {
  const runDir = join(dir, 'runs', run.id)
  mkdirSync(join(runDir, 'attachments'), { recursive: true })
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run))
  writeFileSync(join(runDir, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n'))
  if (bytes > 0) {
    writeFileSync(join(runDir, 'attachments', '1-video.webm'), Buffer.alloc(bytes))
  }
}

function createStore(isProcessAlive: (pid: number) => boolean = () => false): TestRunStore {
  return new TestRunStore({ dir, now: () => NOW, isProcessAlive })
}

describe('TestRunStore', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-run-store-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists runs newest first and filters by worktree', () => {
    writeRun(makeRun('old', { startedAt: NOW - 3 * DAY }), [])
    writeRun(makeRun('new', { startedAt: NOW - DAY }), [])
    writeRun(makeRun('other', { worktreeId: 'repo::/w/feature' }), [])
    const store = createStore()
    expect(store.listRuns({ worktreeId: 'repo::/w/main' }).map((run) => run.id)).toEqual([
      'new',
      'old'
    ])
    expect(store.listRuns({ repoKey: 'github.com/o/tests', limit: 1 })).toHaveLength(1)
  })

  it('returns the latest final result per test', () => {
    writeRun(makeRun('r1', { startedAt: NOW - 2 * DAY }), [
      makeResult('a', { status: 'failed', outcome: 'unexpected' }),
      makeResult('b')
    ])
    writeRun(makeRun('r2', { startedAt: NOW - DAY }), [
      makeResult('a', { retry: 0, isFinalAttempt: false, status: 'failed' }),
      makeResult('a', { retry: 1 })
    ])
    const latest = createStore().getLatestResults({ worktreeId: 'repo::/w/main' })
    expect(
      latest.map((entry) => [entry.result.identity, entry.run.id, entry.result.status])
    ).toEqual([
      ['a', 'r2', 'passed'],
      ['b', 'r1', 'passed']
    ])
  })

  it("returns a test's history across runs", () => {
    writeRun(makeRun('r1', { startedAt: NOW - 2 * DAY }), [makeResult('a', { status: 'failed' })])
    writeRun(makeRun('r2', { startedAt: NOW - DAY }), [makeResult('a')])
    writeRun(makeRun('r3', { startedAt: NOW - 0.5 * DAY }), [makeResult('b')])
    const history = createStore().getHistory('a')
    expect(history.map((entry) => [entry.run.id, entry.result.status])).toEqual([
      ['r2', 'passed'],
      ['r1', 'failed']
    ])
  })

  it('marks a running run whose process is gone as interrupted', () => {
    writeRun(makeRun('live', { status: 'running', endedAt: null, pid: 1 }), [])
    writeRun(makeRun('dead', { status: 'running', endedAt: null, pid: 2 }), [])
    const runs = createStore((pid) => pid === 1).listRuns()
    expect(Object.fromEntries(runs.map((run) => [run.id, run.status]))).toEqual({
      live: 'running',
      dead: 'interrupted'
    })
    const saved = JSON.parse(readFileSync(join(dir, 'runs', 'dead', 'run.json'), 'utf8'))
    expect(saved.status).toBe('interrupted')
  })

  it('never prunes running runs or the latest result of a test', () => {
    writeRun(makeRun('only-a', { startedAt: NOW - 40 * DAY }), [makeResult('a')])
    writeRun(
      makeRun('running', { startedAt: NOW - 40 * DAY, status: 'running', endedAt: null, pid: 9 }),
      []
    )
    writeRun(makeRun('stale-b', { startedAt: NOW - 30 * DAY }), [makeResult('b')])
    writeRun(makeRun('fresh-b', { startedAt: NOW - DAY }), [makeResult('b')])
    const { removedRunIds } = createStore((pid) => pid === 9).prune()
    expect(removedRunIds).toEqual(['stale-b'])
    expect(existsSync(join(dir, 'runs', 'only-a'))).toBe(true)
  })

  it('prunes runs older than the age limit', () => {
    writeRun(makeRun('old', { startedAt: NOW - 20 * DAY }), [makeResult('a')])
    writeRun(makeRun('new', { startedAt: NOW - DAY }), [makeResult('a')])
    expect(createStore().prune({ maxAgeDays: 14 }).removedRunIds).toEqual(['old'])
  })

  it('prunes oldest runs above the size limit', () => {
    writeRun(makeRun('r1', { startedAt: NOW - 3 * DAY }), [makeResult('a')], 4000)
    writeRun(makeRun('r2', { startedAt: NOW - 2 * DAY }), [makeResult('a')], 4000)
    writeRun(makeRun('r3', { startedAt: NOW - DAY }), [makeResult('a')], 4000)
    // Each run is a 4000-byte video plus under 1000 bytes of JSON.
    expect(createStore().prune({ maxBytes: 10_000 }).removedRunIds).toEqual(['r1'])
  })

  it('reads image artifacts as data URLs within the size limit', () => {
    writeRun(makeRun('r1'), [])
    const attachments = join(dir, 'runs', 'r1', 'attachments')
    writeFileSync(join(attachments, '1-screenshot.png'), Buffer.from('png'))
    writeFileSync(join(attachments, '2-big.png'), Buffer.alloc(2000))
    const store = createStore()
    expect(store.readImageDataUrl('r1', 'attachments/1-screenshot.png', 1000)).toBe(
      `data:image/png;base64,${Buffer.from('png').toString('base64')}`
    )
    expect(store.readImageDataUrl('r1', 'attachments/2-big.png', 1000)).toBeNull()
    expect(store.readImageDataUrl('r1', 'run.json', 1000)).toBeNull()
  })

  it('rejects artifact paths outside the run', () => {
    writeRun(makeRun('r1'), [], 10)
    const store = createStore()
    expect(store.getArtifactPath('r1', 'attachments/1-video.webm')).toBe(
      join(dir, 'runs', 'r1', 'attachments', '1-video.webm')
    )
    expect(store.getArtifactPath('r1', '../../secret')).toBeNull()
    expect(store.getArtifactPath('../r1', 'run.json')).toBeNull()
  })
})
