import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findPlaywrightConfigs, listTestRunSources } from './test-run-sources'

let dir: string

describe('test run sources', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-run-sources-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists origin/main and worktrees of repos with a Playwright config', () => {
    const tests = join(dir, 'tests')
    mkdirSync(tests)
    writeFileSync(join(tests, 'playwright.admin.config.ts'), '')
    writeFileSync(join(tests, 'playwright.config.ts'), '')
    mkdirSync(join(dir, 'eshop'))
    expect(findPlaywrightConfigs(tests)).toEqual([
      'playwright.config.ts',
      'playwright.admin.config.ts'
    ])
    expect(
      listTestRunSources({
        repos: [
          { id: 'r-tests', path: tests, name: 'tests' },
          { id: 'r-eshop', path: join(dir, 'eshop'), name: 'eshop' }
        ],
        worktrees: [
          { id: 'w-feature', repoId: 'r-tests', path: '/w/feature', label: 'omp-2697' },
          { id: 'w-eshop', repoId: 'r-eshop', path: '/w/eshop', label: 'eshop' }
        ]
      })
    ).toEqual([
      { kind: 'origin-main', repoId: 'r-tests', repoPath: tests, label: 'tests @ origin/main' },
      {
        kind: 'worktree',
        repoId: 'r-tests',
        worktreeId: 'w-feature',
        path: '/w/feature',
        label: 'tests · omp-2697'
      }
    ])
  })

  it('skips remote repos', () => {
    writeFileSync(join(dir, 'playwright.config.ts'), '')
    expect(
      listTestRunSources({
        repos: [{ id: 'r', path: dir, name: 'tests', connectionId: 'ssh-1' }],
        worktrees: []
      })
    ).toEqual([])
  })
})
