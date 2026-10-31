import { describe, expect, it } from 'vitest'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { summarizeRepoTiers, summarizeWorkspaces } from './test-runs-overview'

function makeRun(id: string, overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    id,
    status: 'passed',
    startedAt: 1000,
    endedAt: 2000,
    pid: 1,
    trigger: 'user',
    worktreeId: 'repo::/w/main',
    paneKey: null,
    repo: { root: '/w/main', originUrl: null, commit: null, branch: null },
    configFile: 'playwright.config.ts',
    argv: [],
    lane: null,
    totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 },
    ...overrides
  }
}

function entry(
  file: string,
  run: TestRunRecord,
  overrides: Partial<TestResultRecord> = {}
): { result: TestResultRecord; run: TestRunRecord } {
  return {
    run,
    result: {
      identity: file,
      configFile: 'playwright.config.ts',
      project: '',
      file,
      line: 1,
      titlePath: [file],
      tags: [],
      annotations: [],
      expectedStatus: 'passed',
      status: 'passed',
      outcome: 'expected',
      retry: 0,
      isFinalAttempt: true,
      durationMs: 1,
      error: null,
      attachments: [],
      stdout: '',
      stderr: '',
      ...overrides
    }
  }
}

describe('test runs overview', () => {
  it('summarizes tiers from the latest results', () => {
    const early = makeRun('r1', { startedAt: 100 })
    const late = makeRun('r2', { startedAt: 500 })
    expect(
      summarizeRepoTiers(
        [
          entry('tests/eshop/tier-1/a.spec.ts', early),
          entry('tests/admin/tier-1/b.spec.ts', late, { status: 'failed', outcome: 'unexpected' }),
          entry('tests/admin/tier-3/c.spec.ts', early, { status: 'skipped', outcome: 'skipped' })
        ],
        {}
      )
    ).toEqual([
      { tier: 1, passed: 1, failed: 1, skipped: 0, lastRunAt: 500 },
      { tier: 3, passed: 0, failed: 0, skipped: 1, lastRunAt: 100 }
    ])
  })

  it('counts tests without a tier separately', () => {
    const run = makeRun('r1')
    expect(
      summarizeRepoTiers([entry('e2e/a.spec.ts', run), entry('tests/tier-2/b.spec.ts', run)], {})
    ).toEqual([
      { tier: 2, passed: 1, failed: 0, skipped: 0, lastRunAt: 1000 },
      { tier: null, passed: 1, failed: 0, skipped: 0, lastRunAt: 1000 }
    ])
  })

  it('lists workspaces by last run with failed counts', () => {
    const runs = [
      makeRun('feature-new', {
        worktreeId: 'repo::/w/feature',
        startedAt: 900,
        totals: { passed: 3, failed: 2, skipped: 0, flaky: 0 }
      }),
      makeRun('main-new', { startedAt: 800 }),
      makeRun('feature-old', { worktreeId: 'repo::/w/feature', startedAt: 100 }),
      makeRun('outside', { worktreeId: null, startedAt: 1000 })
    ]
    expect(
      summarizeWorkspaces(runs).map((workspace) => [
        workspace.worktreeId,
        workspace.lastRun.id,
        workspace.failedTests
      ])
    ).toEqual([
      ['repo::/w/feature', 'feature-new', 2],
      ['repo::/w/main', 'main-new', 0]
    ])
  })

  it('counts lower tiers into higher ones when tiers are cumulative', () => {
    const run = makeRun('r1')
    expect(
      summarizeRepoTiers(
        [
          entry('tests/tier-1/a.spec.ts', run),
          entry('tests/tier-2/b.spec.ts', run, { status: 'failed', outcome: 'unexpected' }),
          entry('tests/tier-3/c.spec.ts', run)
        ],
        { cumulativeTiers: true }
      ).map((tier) => [tier.tier, tier.passed, tier.failed])
    ).toEqual([
      [1, 1, 0],
      [2, 1, 1],
      [3, 2, 1]
    ])
  })

  it("uses the repo's tier pattern", () => {
    const run = makeRun('r1')
    expect(
      summarizeRepoTiers([entry('e2e/smoke-2/a.spec.ts', run)], {
        tierPattern: /smoke-(\d+)\//
      }).map((tier) => tier.tier)
    ).toEqual([2])
  })
})
