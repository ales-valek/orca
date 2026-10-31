import { describe, expect, it } from 'vitest'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import type {
  TestRunSourceOption,
  TestRunTargetOption
} from '../../../../shared/test-runs/test-run-launch-types'
import {
  getDefaultSource,
  getDefaultTarget,
  getSelectionForFailed,
  getSelectionForFolder,
  getSelectionForTests,
  getSelectionForTier
} from './test-run-selection'

const RUN: TestRunRecord = {
  id: 'r',
  status: 'passed',
  startedAt: 0,
  endedAt: 1,
  pid: 1,
  trigger: 'agent',
  worktreeId: null,
  paneKey: null,
  repo: { root: '/w', originUrl: null, commit: null, branch: null },
  configFile: 'playwright.config.ts',
  argv: [],
  lane: null,
  totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 }
}

function entry(
  file: string,
  line: number,
  outcome: TestResultRecord['outcome'] = 'expected'
): { result: TestResultRecord; run: TestRunRecord } {
  return {
    run: RUN,
    result: {
      identity: `${file}:${line}`,
      configFile: 'playwright.config.ts',
      project: '',
      file,
      line,
      titlePath: [file],
      tags: [],
      annotations: [],
      expectedStatus: 'passed',
      status: outcome === 'unexpected' ? 'failed' : 'passed',
      outcome,
      retry: 0,
      isFinalAttempt: true,
      durationMs: 1,
      error: null,
      attachments: [],
      stdout: '',
      stderr: ''
    }
  }
}

describe('test run selection', () => {
  it('selects tests by file and line without duplicates', () => {
    expect(
      getSelectionForTests([
        entry('tests/a.spec.ts', 3),
        entry('tests/a.spec.ts', 3),
        entry('tests/b.spec.ts', 9)
      ])
    ).toEqual({ kind: 'tests', locations: ['tests/a.spec.ts:3', 'tests/b.spec.ts:9'] })
  })

  it('selects only failed tests', () => {
    expect(
      getSelectionForFailed([
        entry('tests/a.spec.ts', 3),
        entry('tests/b.spec.ts', 9, 'unexpected')
      ])
    ).toEqual({ kind: 'tests', locations: ['tests/b.spec.ts:9'] })
  })

  it('selects a folder and a tier', () => {
    expect(getSelectionForFolder('tests/eshop/tier-1')).toEqual({
      kind: 'paths',
      paths: ['tests/eshop/tier-1/']
    })
    expect(getSelectionForTier(2)).toEqual({ kind: 'paths', paths: ['tier-2/'] })
  })

  it("defaults to the workspace's environment and the test repo's origin/main", () => {
    const targets: TestRunTargetOption[] = [
      { id: 'preset:dev', target: { kind: 'preset', name: 'dev' }, label: 'dev', isShared: true },
      {
        id: 'dev-env:kiosek',
        target: { kind: 'dev-env', devEnvId: 'kiosek' },
        label: 'Kiosek',
        isShared: false
      }
    ]
    expect(getDefaultTarget(targets, 'kiosek')).toBe('dev-env:kiosek')
    expect(getDefaultTarget(targets, null)).toBe('preset:dev')
    const sources: TestRunSourceOption[] = [
      {
        id: 'worktree:w',
        kind: 'worktree',
        repoId: 'tests',
        path: '/w/feature',
        label: 'tests · feature',
        configFiles: []
      },
      {
        id: 'origin-main:tests',
        kind: 'origin-main',
        repoId: 'tests',
        path: '/r/tests',
        label: 'tests @ origin/main',
        configFiles: []
      }
    ]
    expect(getDefaultSource(sources, 'tests')).toBe('origin-main:tests')
    expect(getDefaultSource(sources, null)).toBe('origin-main:tests')
    expect(getDefaultSource([], null)).toBeNull()
  })
})
