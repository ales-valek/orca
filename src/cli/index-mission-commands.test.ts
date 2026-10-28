import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { okFixture, queueFixtures } from './test-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'
import { RuntimeRpcFailureError } from './runtime/types'

const MISSION = {
  id: 'mission-1',
  name: 'Referral',
  branch: 'mission/referral',
  rootPath: '/missions/referral',
  members: [
    {
      repoId: 'repo-api',
      repoName: 'api',
      worktreeId: 'repo-api::/missions/referral/api',
      worktreePath: '/missions/referral/api',
      branch: 'mission/referral'
    }
  ]
}

describe('orca mission commands', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('lists Missions in human-readable form', async () => {
    queueFixtures(callMock, okFixture('req_1', { missions: [MISSION] }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'list'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('mission.list')
    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      'mission-1  Referral  mission/referral  1 repos  /missions/referral'
    )
  })

  it('passes a positional Mission selector to show', async () => {
    queueFixtures(callMock, okFixture('req_1', { mission: MISSION }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'show', 'Referral'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('mission.show', { mission: 'Referral' })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('rootPath: /missions/referral')
    expect(output).toContain('api (repo-api)  /missions/referral/api  mission/referral')
    expect(output).not.toContain('brief:')
  })

  it('prints the brief path of a Mission imported from Huly', async () => {
    const briefPath = '/missions/referral/MISSION.md'
    queueFixtures(callMock, okFixture('req_1', { mission: { ...MISSION, briefPath } }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'show', 'Referral'], '/tmp')

    expect(logSpy.mock.calls.flat().join('\n')).toContain(`brief: ${briefPath}`)
  })

  it('resolves the current Mission from the cwd', async () => {
    queueFixtures(callMock, okFixture('req_1', { mission: MISSION }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'current', '--json'], '/missions/referral/api/src')

    expect(callMock).toHaveBeenCalledWith('mission.forPath', {
      path: '/missions/referral/api/src'
    })
  })

  it('explains when no Mission contains the cwd', async () => {
    callMock.mockRejectedValueOnce(
      new RuntimeRpcFailureError({
        id: 'req_1',
        ok: false,
        error: { code: 'selector_not_found', message: 'selector_not_found' },
        _meta: { runtimeId: 'runtime-1' }
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'current'], '/tmp/elsewhere')

    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'No Mission root or member worktree contains the current directory: /tmp/elsewhere'
    )
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('rejects `mission current` against a remote runtime', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'current', '--pairing-code', 'remote-runtime'], '/tmp')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('sends repeated --repo selectors, branch, and agent to create', async () => {
    queueFixtures(callMock, okFixture('req_1', { mission: MISSION, memberResults: [] }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'mission',
        'create',
        '--name',
        'Referral',
        '--repo',
        'name:api',
        '--repo',
        'id:repo-web',
        '--branch',
        'mission/referral',
        '--agent',
        'claude',
        '--json'
      ],
      '/tmp'
    )

    expect(callMock).toHaveBeenCalledWith('mission.create', {
      name: 'Referral',
      repos: ['name:api', 'id:repo-web'],
      branch: 'mission/referral',
      agent: 'claude'
    })
  })

  it('creates a Mission from a Huly milestone and prints its warnings', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        mission: MISSION,
        warnings: ['OMP-951: mission_member_worktree_missing']
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'mission',
        'create',
        '--from-huly',
        'Kiosek',
        '--project',
        'OMP',
        '--orchestrator-repo',
        'name:orch'
      ],
      '/tmp'
    )

    expect(callMock).toHaveBeenCalledWith('mission.createFromHuly', {
      milestone: 'Kiosek',
      project: 'OMP',
      orchestratorRepo: 'name:orch'
    })
    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      'warning: OMP-951: mission_member_worktree_missing'
    )
  })

  it('prints the refresh diff groups and keeps exit code 0 with non-appendable issues', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        mission: MISSION,
        diff: {
          appendable: [{ repoId: 'repo-api', issues: [{ identifier: 'OMP-3', title: 'Third' }] }],
          nonAppendable: [
            { repoId: 'repo-api', identifier: 'OMP-5', reason: 'inserted-in-middle' }
          ],
          reorderedInHuly: [],
          removed: ['OMP-2'],
          movedRepo: [{ identifier: 'OMP-4', fromRepoId: 'repo-api', toRepoId: 'repo-web' }]
        },
        applied: [],
        warnings: []
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const priorExitCode = process.exitCode
    process.exitCode = undefined

    await main(['mission', 'refresh', 'Referral', '--apply'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('mission.refresh', {
      mission: 'Referral',
      apply: true
    })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('OMP-3  Third  (repo-api)')
    expect(output).toContain('OMP-5  repo-api  inserted-in-middle')
    expect(output).toContain('OMP-4  repo-api -> repo-web')
    expect(output).toContain('Removed:')
    expect(process.exitCode).toBeUndefined()
    process.exitCode = priorExitCode
  })

  it('refuses --from-huly together with --repo', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'create', '--from-huly', 'Kiosek', '--repo', 'name:api'], '/tmp')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('requires at least one --repo for create', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'create', '--name', 'Referral'], '/tmp')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('adds repos to a positional Mission and reports member errors', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        mission: MISSION,
        memberResults: [{ repoId: 'repo-web', worktreeId: null, error: 'branch exists' }]
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'add-repo', 'Referral', '--repo', 'name:web'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('mission.addRepos', {
      mission: 'Referral',
      repos: ['name:web']
    })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('error (repo-web): branch exists')
  })

  it('deletes worktrees by default and detaches them with --keep-worktrees', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', { missionId: 'mission-1', deleted: true, memberResults: [] }),
      okFixture('req_2', { missionId: 'mission-1', deleted: true, memberResults: [] })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'rm', 'Referral'], '/tmp')
    await main(['mission', 'rm', 'Referral', '--keep-worktrees'], '/tmp')

    expect(callMock).toHaveBeenNthCalledWith(1, 'mission.remove', {
      mission: 'Referral',
      deleteWorktrees: true
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'mission.remove', {
      mission: 'Referral',
      deleteWorktrees: false
    })
  })

  it('exits non-zero when a Mission could not be deleted', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        missionId: 'mission-1',
        deleted: false,
        memberResults: [{ repoId: 'repo-api', worktreeId: 'w', error: 'dirty worktree' }]
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'rm', 'Referral'], '/tmp')

    expect(logSpy.mock.calls.flat().join('\n')).toContain('error (repo-api): dirty worktree')
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('adds a task through mission.addTask with the tracker ref', async () => {
    queueFixtures(callMock, okFixture('req_1', { mission: MISSION, task: null }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'mission',
        'task',
        'add',
        'kiosek',
        '--repo',
        'name:eshop',
        '--title',
        'X',
        '--ref',
        'OMP-951'
      ],
      '/tmp'
    )

    expect(callMock).toHaveBeenCalledWith('mission.addTask', {
      mission: 'kiosek',
      repo: 'name:eshop',
      title: 'X',
      ref: 'OMP-951'
    })
  })

  it('removes the top task through mission.removeTask', async () => {
    queueFixtures(callMock, okFixture('req_1', { mission: MISSION, task: null }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'task', 'rm', 'kiosek', '--repo', 'name:eshop'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('mission.removeTask', {
      mission: 'kiosek',
      repo: 'name:eshop'
    })
  })

  it('exits non-zero when a task operation reports an error', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', { mission: MISSION, task: null, error: 'mission_task_not_found' })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'task', 'rm', 'kiosek', '--repo', 'name:eshop'], '/tmp')

    expect(logSpy.mock.calls.flat().join('\n')).toContain('error: mission_task_not_found')
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('restacks one repo or the whole Mission and prints layer states', async () => {
    const reports = [
      {
        repoId: 'repo-api',
        layers: [
          { slot: 'member', state: 'current' },
          { slot: 'task:a', state: 'blocked', reason: 'Uncommitted changes' }
        ]
      }
    ]
    queueFixtures(callMock, okFixture('req_1', { reports }), okFixture('req_2', { reports }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'restack', 'kiosek', '--repo', 'name:api'], '/tmp')
    await main(['mission', 'restack', 'kiosek'], '/tmp')

    expect(callMock).toHaveBeenNthCalledWith(1, 'mission.restack', {
      mission: 'kiosek',
      repo: 'name:api'
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'mission.restack', { mission: 'kiosek' })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('task:a  blocked (Uncommitted changes)')
  })

  it('sends --choose pairs to absorb as a record', async () => {
    queueFixtures(callMock, okFixture('req_1', { applied: 2, ambiguous: [] }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'mission',
        'absorb',
        'kiosek',
        '--repo',
        'name:eshop',
        '--choose',
        'src/a.ts:12=OMP-1',
        '--choose',
        'src/b.ts:3=OMP-2'
      ],
      '/tmp'
    )

    expect(callMock).toHaveBeenCalledWith('mission.absorb', {
      mission: 'kiosek',
      repo: 'name:eshop',
      choose: { 'src/a.ts:12': 'OMP-1', 'src/b.ts:3': 'OMP-2' }
    })
  })

  it('exits non-zero and lists ambiguous hunks when absorb is unresolved', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        applied: 1,
        ambiguous: [
          {
            file: 'src/a.ts',
            line: 12,
            candidateTaskIds: ['a', 'b'],
            candidateRefs: ['OMP-1', 'OMP-2']
          }
        ]
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'absorb', 'kiosek', '--repo', 'name:eshop'], '/tmp')

    expect(logSpy.mock.calls.flat().join('\n')).toContain('src/a.ts:12')
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('rejects a malformed --choose value', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['mission', 'absorb', 'kiosek', '--repo', 'name:eshop', '--choose', 'nope'], '/tmp')

    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('prints each stack bottom-up with state, branch and path', async () => {
    const mission = {
      ...MISSION,
      stacks: [
        {
          repoId: 'repo-api',
          repoName: 'api',
          layers: [
            {
              slot: 'member',
              title: null,
              externalRef: null,
              branch: 'mission/referral',
              worktreePath: '/missions/referral/api',
              state: 'current'
            },
            {
              slot: 'task:a',
              title: 'First',
              externalRef: 'OMP-1',
              branch: 'mission-task/referral/omp-1',
              worktreePath: '/missions/referral/api--omp-1',
              state: 'stale',
              reason: 'parent moved'
            }
          ]
        }
      ]
    }
    queueFixtures(callMock, okFixture('req_1', { mission }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['mission', 'show', 'Referral'], '/tmp')

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('stack api (repo-api):')
    expect(output).toContain(
      'task:a  OMP-1  stale (parent moved)  mission-task/referral/omp-1  /missions/referral/api--omp-1'
    )
    expect(output.indexOf('member  ')).toBeLessThan(output.indexOf('task:a  '))
  })
})
