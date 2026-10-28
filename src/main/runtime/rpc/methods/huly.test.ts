import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import type { Mission, MissionSource } from '../../../../shared/mission-types'
import { FakeHulyApi } from '../../../huly/fake-huly-api'
import { HulyConnection } from '../../../huly/huly-connection'
import type { MissionCreateInput } from '../../../ipc/mission-ipc-args'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { HULY_METHODS } from './huly'
import { MISSION_METHODS } from './missions'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

const REPOS = [
  { id: 'repo-eshop', path: '/src/eshop', displayName: 'eshop', badgeColor: 'blue', addedAt: 1 }
]

function createIssue(number: number): HulyIssue {
  return {
    id: `id-${number}`,
    identifier: `OMP-${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://huly.test/OMP-${number}`,
    status: { name: 'Todo', category: 'ToDo' },
    componentId: 'c-eshop',
    blockedBy: [],
    parentIssueId: null
  }
}

function makeHarness() {
  const api = new FakeHulyApi()
  api.milestones = [
    { id: 'ms-1', label: 'Kiosek', status: 'In Progress', descriptionMarkdown: '', url: 'u' }
  ]
  api.issuesByMilestone.set('ms-1', [createIssue(2), createIssue(1)])
  let mission: Mission | null = null
  const store = {
    getRepos: () => REPOS,
    getRepo: (id: string) => REPOS.find((repo) => repo.id === id) ?? null,
    getSettings: () => ({
      workspaceDir: '/nonexistent-workspace',
      hulyProjects: { OMP: { componentRepoMap: { 'c-eshop': 'repo-eshop' } } }
    }),
    getMission: () => mission,
    setMissionSource: vi.fn((_id: string, source: MissionSource) => {
      mission = mission && { ...mission, source }
      return mission
    })
  }
  const operations = {
    list: () => (mission ? [mission] : []),
    create: vi.fn(async (args: MissionCreateInput) => {
      mission = {
        id: 'mission-1',
        name: args.name,
        branchName: args.branchName ?? 'mission/x',
        members: [{ repoId: 'repo-eshop', worktreeId: null, addedAt: 1 }],
        tabOrder: 0,
        rootPath: '/nonexistent-workspace/missions/kiosek-1',
        createdAt: 1,
        updatedAt: 1
      }
      return { mission, memberResults: [] }
    }),
    addTask: vi.fn(async (_args: { externalRef?: string | null }) => ({
      mission: store.getMission(),
      task: null
    }))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Huly RPC only reads repos, settings and Mission source from the store.
  const runtime = new OrcaRuntimeService(store as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub covers every MissionOperations method the Huly import calls.
  runtime.attachMissionOperations(operations as never)
  runtime.attachHulyConnection(
    new HulyConnection({
      createApi: async () => api,
      store: {
        readInfo: () => ({ serverUrl: 'https://huly.test', workspace: 'ordermage' }),
        readToken: () => 'secret-token',
        hasToken: () => true,
        save: () => {},
        clear: () => {}
      }
    })
  )
  const dispatcher = new RpcDispatcher({ runtime, methods: [...HULY_METHODS, ...MISSION_METHODS] })
  return { dispatcher, operations, store, api }
}

describe('Huly RPC methods', () => {
  it('previews the milestone plan in stack order', async () => {
    const { dispatcher } = makeHarness()

    const response = await dispatcher.dispatch(
      makeRequest('huly.getMilestonePlan', { project: 'OMP', milestoneId: 'ms-1' })
    )

    expect(response).toMatchObject({
      ok: true,
      result: { milestone: { label: 'Kiosek' }, plan: { unmapped: [], cycles: [] } }
    })
    const plan = 'result' in response ? response.result : null
    expect(JSON.stringify(plan)).toContain('"identifier":"OMP-1"')
  })

  it('creates a Mission from a milestone label using the only configured project', async () => {
    const { dispatcher, operations, store } = makeHarness()

    const response = await dispatcher.dispatch(
      makeRequest('mission.createFromHuly', { milestone: 'kiosek' })
    )

    expect(operations.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Kiosek', repoIds: ['repo-eshop'] })
    )
    expect(store.setMissionSource).toHaveBeenCalledWith(
      'mission-1',
      expect.objectContaining({ project: 'OMP', milestoneId: 'ms-1' })
    )
    expect(operations.addTask.mock.calls.map(([args]) => args)).toMatchObject([
      { externalRef: 'OMP-1' },
      { externalRef: 'OMP-2' }
    ])
    expect(response).toMatchObject({
      ok: true,
      result: {
        mission: { id: 'mission-1' },
        warnings: ['MISSION.md was not written: the Mission root does not exist yet']
      }
    })
  })

  it('refreshes a Mission: previews the diff, then appends the new issue on apply', async () => {
    const { dispatcher, operations, api } = makeHarness()
    await dispatcher.dispatch(makeRequest('mission.createFromHuly', { milestone: 'kiosek' }))
    operations.addTask.mockClear()
    api.issuesByMilestone.set('ms-1', [createIssue(2), createIssue(1), createIssue(3)])

    const preview = await dispatcher.dispatch(makeRequest('mission.refresh', { mission: 'Kiosek' }))

    expect(preview).toMatchObject({
      ok: true,
      result: {
        applied: [],
        diff: { appendable: [{ repoId: 'repo-eshop', issues: [{ identifier: 'OMP-3' }] }] }
      }
    })
    expect(operations.addTask).not.toHaveBeenCalled()

    await dispatcher.dispatch(makeRequest('mission.refresh', { mission: 'Kiosek', apply: true }))

    expect(operations.addTask.mock.calls.map(([args]) => args)).toMatchObject([
      { externalRef: 'OMP-3', externalId: 'id-3' }
    ])
  })
})
