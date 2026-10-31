import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestIdentity } from '../../shared/test-runs/test-identity'
import type { TestResultRecord, TestRunRecord } from '../../shared/test-runs/test-run-types'
import { getOrcaPlaywrightReporterSource } from './orca-playwright-reporter-source'

type FakeReporter = {
  printsToStdio(): boolean
  onBegin(config: unknown, suite: unknown): void
  onTestEnd(test: unknown, result: unknown): void
  onEnd(result: unknown): void
}

const AGENT_ENV = ['ORCA_AGENT_LAUNCH', 'ORCA_AGENT_LAUNCH_TOKEN', 'CLAUDECODE', 'CODEX_THREAD_ID']

let dir: string
let repo: string
let runsDir: string

function loadReporter(options: { lane?: string } = {}): FakeReporter {
  const file = join(dir, `reporter-${Math.random().toString(36).slice(2)}.cjs`)
  writeFileSync(file, getOrcaPlaywrightReporterSource())
  const Reporter = createRequire(import.meta.url)(file)
  return new Reporter(options)
}

function fakeTest(
  title: string,
  options: { retries?: number; outcome?: string; file?: string } = {}
): Record<string, unknown> {
  const file = options.file ?? 'tests/tier-1/cart.spec.ts'
  return {
    title,
    // Playwright's title path starts with the root, project and file suites.
    titlePath: () => ['', 'chromium', file, 'Cart', title],
    location: { file: join(repo, file), line: 7, column: 3 },
    parent: { project: () => ({ name: 'chromium' }) },
    tags: ['@serial'],
    annotations: [{ type: 'bug-pin', description: 'CART-1' }],
    expectedStatus: 'passed',
    retries: options.retries ?? 0,
    outcome: () => options.outcome ?? 'expected'
  }
}

function fakeResult(status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status,
    duration: 120,
    retry: 0,
    errors: status === 'failed' ? [{ message: '\u001b[31mexpected visible\u001b[39m' }] : [],
    attachments: [],
    stdout: ['log line\n'],
    stderr: [],
    ...extra
  }
}

function readRun(): { run: TestRunRecord; results: TestResultRecord[]; runDir: string } {
  const [id] = readdirSync(join(runsDir, 'runs'))
  const runDir = join(runsDir, 'runs', id)
  const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
  const results = readFileSync(join(runDir, 'results.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  return { run, results, runDir }
}

const config = (): Record<string, unknown> => ({
  configFile: join(repo, 'playwright.config.ts'),
  rootDir: join(repo, 'tests')
})

describe('Orca Playwright reporter', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-runs-'))
    repo = join(dir, 'tests-repo')
    runsDir = join(dir, 'store')
    mkdirSync(repo)
    vi.stubEnv('ORCA_TEST_RUNS_DIR', runsDir)
    vi.stubEnv('ORCA_WORKTREE_ID', 'repo-1::/w/feature')
    vi.stubEnv('ORCA_PANE_KEY', 'tab-1:leaf-1')
    vi.stubEnv('ORCA_TEST_RUN_TRIGGER', '')
    for (const key of AGENT_ENV) {
      vi.stubEnv(key, '')
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a run with results and totals', () => {
    const reporter = loadReporter({ lane: 'eshop' })
    expect(reporter.printsToStdio()).toBe(false)
    reporter.onBegin(config(), {})
    reporter.onTestEnd(fakeTest('adds it'), fakeResult('passed'))
    reporter.onTestEnd(fakeTest('removes it', { outcome: 'unexpected' }), fakeResult('failed'))
    reporter.onEnd({ status: 'failed' })

    const { run, results } = readRun()
    expect(run).toMatchObject({
      status: 'failed',
      trigger: 'user',
      worktreeId: 'repo-1::/w/feature',
      paneKey: 'tab-1:leaf-1',
      configFile: 'playwright.config.ts',
      lane: 'eshop',
      totals: { passed: 1, failed: 1, skipped: 0, flaky: 0 }
    })
    expect(run.endedAt).toEqual(expect.any(Number))
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      identity: getTestIdentity({
        originUrl: null,
        repoRootName: basename(repo),
        configFile: 'playwright.config.ts',
        project: 'chromium',
        file: 'tests/tier-1/cart.spec.ts',
        titlePath: ['Cart', 'adds it']
      }),
      file: 'tests/tier-1/cart.spec.ts',
      line: 7,
      titlePath: ['Cart', 'adds it'],
      tags: ['@serial'],
      annotations: [{ type: 'bug-pin', description: 'CART-1' }],
      isFinalAttempt: true,
      stdout: 'log line\n'
    })
    expect(results[1].error).toEqual({
      message: 'expected visible',
      location: null
    })
  })

  it('keeps every attempt and marks the final one', () => {
    const reporter = loadReporter()
    reporter.onBegin(config(), {})
    const test = fakeTest('flaky one', { retries: 1, outcome: 'flaky' })
    reporter.onTestEnd(test, fakeResult('failed', { retry: 0 }))
    reporter.onTestEnd(test, fakeResult('passed', { retry: 1 }))
    reporter.onEnd({ status: 'passed' })

    const { run, results } = readRun()
    expect(results.map((result) => [result.retry, result.isFinalAttempt])).toEqual([
      [0, false],
      [1, true]
    ])
    expect(run.totals).toEqual({ passed: 0, failed: 0, skipped: 0, flaky: 1 })
  })

  it("counts each test's last record, even one interrupted before its retries", () => {
    const reporter = loadReporter()
    reporter.onBegin(config(), {})
    reporter.onTestEnd(
      fakeTest('interrupted', { retries: 1, outcome: 'unexpected' }),
      fakeResult('interrupted', { retry: 0 })
    )
    reporter.onEnd({ status: 'interrupted' })
    expect(readRun().run.totals).toEqual({ passed: 0, failed: 1, skipped: 0, flaky: 0 })
  })

  it('writes body attachments and survives a failing copy', () => {
    const reporter = loadReporter()
    reporter.onBegin(config(), {})
    const video = join(dir, 'video.webm')
    writeFileSync(video, 'webm')
    reporter.onTestEnd(
      fakeTest('with artifacts'),
      fakeResult('passed', {
        attachments: [
          { name: 'screenshot', contentType: 'image/png', body: Buffer.from('png') },
          { name: 'video', contentType: 'video/webm', path: video },
          { name: 'trace', contentType: 'application/zip', path: join(dir, 'missing.zip') }
        ]
      })
    )
    reporter.onEnd({ status: 'passed' })

    const { results, runDir } = readRun()
    const attachments = results[0].attachments
    expect(attachments.map((attachment) => attachment.name)).toEqual(['screenshot', 'video'])
    expect(readFileSync(join(runDir, attachments[0].file), 'utf8')).toBe('png')
    expect(readFileSync(join(runDir, attachments[1].file), 'utf8')).toBe('webm')
    expect(attachments[1].file).toMatch(/\.webm$/)
  })

  it('records the dev env and launch of a run', () => {
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(join(runsDir, 'targets.json'), JSON.stringify({ 'repo-1::/w/feature': 'kiosek' }))
    vi.stubEnv('ORCA_TEST_LAUNCH_ID', 'launch-7')
    const reporter = loadReporter()
    reporter.onBegin(config(), {})
    reporter.onEnd({ status: 'passed' })
    expect(readRun().run).toMatchObject({ devEnvId: 'kiosek', launchId: 'launch-7' })
  })

  it('records who ran it', () => {
    const triggers: string[] = []
    for (const env of [{ ORCA_AGENT_LAUNCH: '1' }, {}, { ORCA_TEST_RUN_TRIGGER: 'orca' }]) {
      for (const [key, value] of Object.entries(env)) {
        vi.stubEnv(key, value)
      }
      const reporter = loadReporter()
      reporter.onBegin(config(), {})
      reporter.onEnd({ status: 'passed' })
      triggers.push(readRun().run.trigger)
      rmSync(join(runsDir, 'runs'), { recursive: true, force: true })
      for (const key of Object.keys(env)) {
        vi.stubEnv(key, '')
      }
    }
    expect(triggers).toEqual(['agent', 'user', 'orca'])
  })

  it('ignores test listing', () => {
    const argv = process.argv
    process.argv = [...argv, 'test', '--list']
    try {
      const reporter = loadReporter()
      reporter.onBegin(config(), {})
      reporter.onEnd({ status: 'passed' })
    } finally {
      process.argv = argv
    }
    expect(() => readdirSync(runsDir)).toThrow()
  })

  it('does nothing without ORCA_TEST_RUNS_DIR', () => {
    vi.stubEnv('ORCA_TEST_RUNS_DIR', '')
    const reporter = loadReporter()
    reporter.onBegin(config(), {})
    reporter.onTestEnd(fakeTest('adds it'), fakeResult('passed'))
    reporter.onEnd({ status: 'passed' })
    expect(() => readdirSync(runsDir)).toThrow()
  })
})
