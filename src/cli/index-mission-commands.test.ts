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
})
