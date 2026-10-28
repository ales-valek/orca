import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../../../shared/mission-types'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { OrcaRuntimeService } from '../../orca-runtime'
import { MISSION_METHODS } from './missions'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

const REPOS = [
  { id: 'repo-api', path: '/src/api', displayName: 'api', badgeColor: 'blue', addedAt: 1 },
  { id: 'repo-web', path: '/src/web', displayName: 'web', badgeColor: 'blue', addedAt: 1 }
]

const MISSION: Mission = {
  id: 'mission-1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [{ repoId: 'repo-api', worktreeId: 'repo-api::/missions/referral/api', addedAt: 1 }],
  tabOrder: 0,
  rootPath: '/missions/referral',
  createdAt: 1,
  updatedAt: 1
}

const STACKED: Mission = {
  ...MISSION,
  tasks: [
    {
      id: 't1',
      repoId: 'repo-api',
      order: 1,
      title: 'Cart',
      branchName: 'mission-task/referral/omp-1',
      worktreeId: 'repo-api::/missions/referral/api--omp-1',
      parentBaseSha: null,
      externalRef: 'OMP-1',
      addedAt: 1
    }
  ]
}

function makeHarness(options: { attach?: boolean } = {}) {
  const store = {
    getRepos: () => REPOS,
    getRepo: (id: string) => REPOS.find((repo) => repo.id === id) ?? null
  }
  const operations = {
    list: vi.fn(() => [MISSION]),
    create: vi.fn(async () => ({ mission: MISSION, memberResults: [] })),
    addMembers: vi.fn(async () => ({ mission: MISSION, memberResults: [] })),
    delete: vi.fn(async () => ({ deleted: true, memberResults: [] })),
    addTask: vi.fn(async () => ({ mission: STACKED, task: STACKED.tasks?.[0] ?? null })),
    removeTopTask: vi.fn(async () => ({ mission: STACKED, task: STACKED.tasks?.[0] ?? null })),
    restack: vi.fn(async () => [{ repoId: 'repo-api', layers: [] }]),
    absorb: vi.fn(async () => ({
      applied: 0,
      ambiguous: [{ file: 'a.ts', line: 3, candidateTaskIds: ['t1'] }]
    })),
    inspectRepo: vi.fn(async () => ({
      repoId: 'repo-api',
      layers: [
        { slot: 'member', state: 'current' },
        { slot: 'task:t1', state: 'blocked', reason: 'Uncommitted changes' }
      ]
    })),
    ensureSession: vi.fn(async () => ({
      id: 'folder-1',
      projectGroupId: 'mission:mission-1',
      missionId: 'mission-1',
      name: 'Referral',
      folderPath: '/missions/referral'
    }))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Mission RPC only reads repos from the runtime store.
  const runtime = new OrcaRuntimeService(store as never)
  if (options.attach !== false) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers every MissionOperations method the runtime calls.
    runtime.attachMissionOperations(operations as never)
  }
  const dispatcher = new RpcDispatcher({ runtime, methods: MISSION_METHODS })
  return { operations, dispatcher }
}

describe('mission RPC methods', () => {
  it('opens the Mission session and returns its folder selector', async () => {
    const { dispatcher, operations } = makeHarness()

    const response = await dispatcher.dispatch(
      makeRequest('mission.session', { mission: 'Referral' })
    )

    expect(operations.ensureSession).toHaveBeenCalledWith('mission-1')
    expect(response).toMatchObject({
      ok: true,
      result: { missionId: 'mission-1', folderId: 'folder-1', folderPath: '/missions/referral' }
    })
  })

  it('adds a task for a resolved repo and a tracker ref', async () => {
    const { operations, dispatcher } = makeHarness()

    const response = await dispatcher.dispatch(
      makeRequest('mission.addTask', {
        mission: 'Referral',
        repo: 'name:api',
        title: 'Cart',
        ref: 'OMP-1'
      })
    )

    expect(operations.addTask).toHaveBeenCalledWith({
      missionId: 'mission-1',
      repoId: 'repo-api',
      title: 'Cart',
      externalRef: 'OMP-1'
    })
    expect(response).toMatchObject({
      ok: true,
      result: { task: { id: 't1', branch: 'mission-task/referral/omp-1', externalRef: 'OMP-1' } }
    })
  })

  it('always deletes the worktree when removing the top task', async () => {
    const { operations, dispatcher } = makeHarness()

    await dispatcher.dispatch(
      makeRequest('mission.removeTask', { mission: 'Referral', repo: 'name:api' })
    )

    expect(operations.removeTopTask).toHaveBeenCalledWith({
      missionId: 'mission-1',
      repoId: 'repo-api',
      deleteWorktree: true
    })
  })

  it('restacks one repo or all of them', async () => {
    const { operations, dispatcher } = makeHarness()

    await dispatcher.dispatch(makeRequest('mission.restack', { mission: 'Referral' }))
    const scoped = await dispatcher.dispatch(
      makeRequest('mission.restack', { mission: 'Referral', repo: 'name:api' })
    )

    expect(operations.restack).toHaveBeenNthCalledWith(1, { missionId: 'mission-1' })
    expect(operations.restack).toHaveBeenNthCalledWith(2, {
      missionId: 'mission-1',
      repoId: 'repo-api'
    })
    expect(scoped).toMatchObject({ ok: true, result: { reports: [{ repoId: 'repo-api' }] } })
  })

  it('maps --choose task refs to ids and names ambiguous candidates by ref', async () => {
    const { operations, dispatcher } = makeHarness()
    operations.list.mockReturnValue([STACKED])

    const response = await dispatcher.dispatch(
      makeRequest('mission.absorb', {
        mission: 'Referral',
        repo: 'name:api',
        choose: { 'a.ts:3': 'OMP-1', 'b.ts:9': 'mission-task/referral/omp-1' }
      })
    )

    expect(operations.absorb).toHaveBeenCalledWith({
      missionId: 'mission-1',
      repoId: 'repo-api',
      overrides: { 'a.ts:3': 't1', 'b.ts:9': 't1' }
    })
    expect(response).toMatchObject({
      ok: true,
      result: { ambiguous: [{ file: 'a.ts', line: 3, candidateRefs: ['OMP-1'] }] }
    })
  })

  it('rejects an unknown --choose task ref and lists the valid ones', async () => {
    const { operations, dispatcher } = makeHarness()
    operations.list.mockReturnValue([STACKED])

    const response = await dispatcher.dispatch(
      makeRequest('mission.absorb', {
        mission: 'Referral',
        repo: 'name:api',
        choose: { 'a.ts:3': 'OMP-404' }
      })
    )

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: expect.stringContaining('Valid refs: OMP-1') }
    })
    expect(operations.absorb).not.toHaveBeenCalled()
  })

  it('shows layer states only on show, not on list', async () => {
    const { operations, dispatcher } = makeHarness()
    operations.list.mockReturnValue([STACKED])

    const listed = await dispatcher.dispatch(makeRequest('mission.list'))
    const shown = await dispatcher.dispatch(makeRequest('mission.show', { mission: 'Referral' }))

    expect(operations.inspectRepo).toHaveBeenCalledTimes(1)
    expect(listed).toMatchObject({
      result: {
        missions: [
          { stacks: [{ layers: [{ slot: 'member' }, { slot: 'task:t1' }, { slot: 'preview' }] }] }
        ]
      }
    })
    expect(JSON.stringify(listed)).not.toContain('"state"')
    expect(shown).toMatchObject({
      result: {
        mission: {
          stacks: [
            {
              layers: [
                { slot: 'member', state: 'current' },
                { slot: 'task:t1', state: 'blocked', reason: 'Uncommitted changes' },
                { slot: 'preview' }
              ]
            }
          ]
        }
      }
    })
  })

  it('lists Missions with resolved member worktree locations', async () => {
    const { dispatcher } = makeHarness()

    const response = await dispatcher.dispatch(makeRequest('mission.list'))

    expect(response).toMatchObject({
      ok: true,
      result: {
        missions: [
          {
            id: 'mission-1',
            branch: 'mission/referral',
            rootPath: '/missions/referral',
            members: [
              {
                repoId: 'repo-api',
                repoName: 'api',
                worktreePath: '/missions/referral/api',
                branch: 'mission/referral'
              }
            ]
          }
        ]
      }
    })
  })

  it('resolves repo selectors before creating through the shared Mission operations', async () => {
    const { operations, dispatcher } = makeHarness()

    const response = await dispatcher.dispatch(
      makeRequest('mission.create', {
        name: 'Referral',
        repos: ['name:api', 'id:repo-web', 'path:/src/api'],
        branch: 'mission/referral',
        agent: 'claude'
      })
    )

    expect(response).toMatchObject({ ok: true, result: { mission: { id: 'mission-1' } } })
    expect(operations.create).toHaveBeenCalledWith({
      name: 'Referral',
      repoIds: ['repo-api', 'repo-web'],
      branchName: 'mission/referral',
      sessionAgent: 'claude'
    })
  })

  it('rejects invalid branches, unknown agents, and unknown repos before mutating', async () => {
    const { operations, dispatcher } = makeHarness()

    const badBranch = await dispatcher.dispatch(
      makeRequest('mission.create', { name: 'R', repos: ['name:api'], branch: 'bad..ref' })
    )
    const badAgent = await dispatcher.dispatch(
      makeRequest('mission.create', { name: 'R', repos: ['name:api'], agent: 'nope' })
    )
    const noRepos = await dispatcher.dispatch(
      makeRequest('mission.create', { name: 'R', repos: [] })
    )
    const unknownRepo = await dispatcher.dispatch(
      makeRequest('mission.create', { name: 'R', repos: ['name:missing'] })
    )

    expect(badBranch).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(badAgent).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(noRepos).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(unknownRepo).toMatchObject({ ok: false, error: { code: 'repo_not_found' } })
    expect(operations.create).not.toHaveBeenCalled()
  })

  it('selects Missions by name for add-repo and remove', async () => {
    const { operations, dispatcher } = makeHarness()

    await dispatcher.dispatch(
      makeRequest('mission.addRepos', { mission: 'Referral', repos: ['name:web'] })
    )
    const removed = await dispatcher.dispatch(
      makeRequest('mission.remove', { mission: 'name:Referral', deleteWorktrees: false })
    )

    expect(operations.addMembers).toHaveBeenCalledWith({
      missionId: 'mission-1',
      repoIds: ['repo-web']
    })
    expect(operations.delete).toHaveBeenCalledWith({
      missionId: 'mission-1',
      deleteWorktrees: false
    })
    expect(removed).toMatchObject({ ok: true, result: { missionId: 'mission-1', deleted: true } })
  })

  it('finds the Mission containing a member worktree path', async () => {
    const { dispatcher } = makeHarness()

    const found = await dispatcher.dispatch(
      makeRequest('mission.forPath', { path: '/missions/referral/api/src' })
    )
    const missing = await dispatcher.dispatch(
      makeRequest('mission.forPath', { path: '/elsewhere' })
    )

    expect(found).toMatchObject({ ok: true, result: { mission: { id: 'mission-1' } } })
    expect(missing).toMatchObject({ ok: false, error: { code: 'selector_not_found' } })
  })

  it('reports Missions as unavailable until the desktop window attaches them', async () => {
    const { dispatcher } = makeHarness({ attach: false })

    const response = await dispatcher.dispatch(makeRequest('mission.list'))

    expect(response).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('desktop window') }
    })
  })
})
