import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTestRunServices, type TestRunServices } from '../../../test-runs/test-run-services'
import { testRunsResultsMethod, testRunsRunMethod } from './test-runs'

const runtime = { showManagedWorktree: vi.fn(async () => ({ id: 'w-eshop', path: '/w/eshop' })) }

describe('test run RPC methods', () => {
  afterEach(() => setTestRunServices(null))

  it('fails without the desktop services', async () => {
    const method = testRunsResultsMethod
    await expect(
      method.handler(method.params?.parse({ worktree: 'path:/w/eshop' }), {
        runtime: runtime as never
      })
    ).rejects.toThrow('Test runs need the Orca desktop app.')
  })

  it('launches with the workspace defaults', async () => {
    const launch = vi.fn<TestRunServices['launch']>(() => ({
      id: 'l1',
      state: 'queued',
      title: '1 test',
      targetLabel: 'Kiosek',
      worktreeId: 'w-eshop',
      startedAt: 1,
      endedAt: null,
      runId: null,
      error: null
    }))
    setTestRunServices({
      listTargets: () => [
        {
          id: 'dev-env:kiosek',
          target: { kind: 'dev-env', devEnvId: 'kiosek' },
          label: 'Kiosek',
          isShared: false
        }
      ],
      listSources: async () => [
        {
          id: 'origin-main:tests',
          kind: 'origin-main',
          repoId: 'tests',
          path: '/r/tests',
          label: 'tests @ origin/main',
          configFiles: ['playwright.config.ts']
        }
      ],
      getDevEnvIdForWorktree: () => 'kiosek',
      getLatestResults: () => [],
      getCatalog: async () => ({
        sourceCommit: null,
        configFile: 'playwright.config.ts',
        entries: [],
        error: null,
        builtAt: 0
      }),
      launch
    })
    const method = testRunsRunMethod
    await method.handler(
      method.params?.parse({
        worktree: 'path:/w/eshop',
        filters: ['tests/eshop/tier-1/cart.spec.ts:12'],
        headed: true
      }),
      {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only call showManagedWorktree.
        runtime: runtime as never
      }
    )
    expect(launch).toHaveBeenCalledWith({
      target: { kind: 'dev-env', devEnvId: 'kiosek' },
      sourceId: 'origin-main:tests',
      configFile: 'playwright.config.ts',
      selection: { kind: 'paths', paths: ['tests/eshop/tier-1/cart.spec.ts:12'] },
      headed: true,
      worktreeId: 'w-eshop'
    })
  })

  it('refuses filters that would read as Playwright options', () => {
    expect(() =>
      testRunsRunMethod.params?.parse({
        worktree: 'path:/w',
        filters: ['--config=/tmp/x.ts']
      })
    ).toThrow()
  })

  it('counts a failure like the panel: not pinned known failures, but interrupted runs', async () => {
    const result = (overrides: Record<string, unknown>) => ({
      run: { id: 'r', startedAt: 1, trigger: 'agent' },
      result: { titlePath: ['t'], file: 'a.spec.ts', line: 1, error: null, ...overrides }
    })
    setTestRunServices({
      listTargets: () => [],
      listSources: async () => [],
      getDevEnvIdForWorktree: () => null,
      getLatestResults: () =>
        [
          result({ titlePath: ['pinned'], status: 'failed', outcome: 'expected' }),
          result({ titlePath: ['broken'], status: 'failed', outcome: 'unexpected' }),
          result({ titlePath: ['cut'], status: 'interrupted', outcome: 'unexpected' })
        ] as never,
      getCatalog: async () => ({
        sourceCommit: null,
        configFile: '',
        entries: [],
        error: null,
        builtAt: 0
      }),
      launch: () => ({ error: 'unused' })
    })
    const method = testRunsResultsMethod
    const output = await method.handler(
      method.params?.parse({ worktree: 'path:/w', failed: true }),
      {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only call showManagedWorktree.
        runtime: runtime as never
      }
    )
    expect(output.results.map((entry) => entry.title)).toEqual(['broken', 'cut'])
  })

  it('refuses a config that is not a Playwright config file', () => {
    expect(() =>
      testRunsRunMethod.params?.parse({ worktree: 'path:/w', config: '--reporter=line' })
    ).toThrow()
    expect(
      testRunsRunMethod.params?.parse({ worktree: 'path:/w', config: 'playwright.admin.config.ts' })
    ).toMatchObject({
      config: 'playwright.admin.config.ts'
    })
  })
})
