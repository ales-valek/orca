import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create, type StateCreator } from 'zustand'
import { createMissionsSlice, missionMemberErrorKey, type MissionsSlice } from './missions'
import { missionSlotErrorKey } from './mission-stack-actions'
import type { Mission, MissionCreateResult } from '../../../../shared/mission-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'

const missionsApi = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  addMembers: vi.fn(),
  removeMember: vi.fn(),
  recreateMemberWorktree: vi.fn(),
  ensureSession: vi.fn(),
  inspectStacks: vi.fn(),
  addTask: vi.fn(),
  removeTask: vi.fn(),
  restack: vi.fn(),
  absorb: vi.fn(),
  createStackPullRequests: vi.fn(),
  pushStack: vi.fn()
}

vi.stubGlobal('window', {
  api: { missions: missionsApi }
})

type TestState = MissionsSlice & {
  folderWorkspaces: FolderWorkspace[]
  fetchFolderWorkspaces: ReturnType<typeof vi.fn>
  purgeWorktreeTerminalState: ReturnType<typeof vi.fn>
}

function makeStore(folderWorkspaces: FolderWorkspace[] = []) {
  const createSlice = createMissionsSlice as unknown as StateCreator<
    TestState,
    [],
    [],
    MissionsSlice
  >
  return create<TestState>()((...args) => ({
    ...createSlice(...args),
    folderWorkspaces,
    fetchFolderWorkspaces: vi.fn(async () => {}),
    purgeWorktreeTerminalState: vi.fn()
  }))
}

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [
    {
      repoId: 'r1',
      worktreeId: 'r1::/wt',
      worktreeInstanceId: 'instance-r1',
      lastError: null,
      addedAt: 1
    },
    {
      repoId: 'r2',
      worktreeId: null,
      worktreeInstanceId: null,
      lastError: null,
      addedAt: 1
    }
  ],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

const missionWithDurableError: Mission = {
  ...mission,
  members: mission.members.map((member) =>
    member.repoId === 'r2' ? { ...member, lastError: 'Branch already exists' } : { ...member }
  )
}

const missionWorkspace = {
  id: 'fw-1',
  missionId: 'm1'
} as FolderWorkspace

beforeEach(() => {
  vi.clearAllMocks()
})

describe('missions slice', () => {
  it('fetchMissions stores missions and rebuilds errors from durable member state', async () => {
    missionsApi.list.mockResolvedValue([missionWithDurableError])
    const store = makeStore()

    await store.getState().fetchMissions()

    expect(store.getState().missions).toEqual([missionWithDurableError])
    expect(store.getState().missionMemberErrors).toEqual({
      [missionMemberErrorKey('m1', 'r2')]: 'Branch already exists'
    })
  })

  it('createMission keeps the result error after refreshing durable mission state', async () => {
    const result: MissionCreateResult = {
      mission: missionWithDurableError,
      memberResults: [
        {
          repoId: 'r1',
          worktreeId: 'r1::/wt',
          worktreeInstanceId: 'instance-r1'
        },
        { repoId: 'r2', worktreeId: null, error: 'Branch already exists' }
      ]
    }
    missionsApi.create.mockResolvedValue(result)
    missionsApi.list.mockResolvedValue([missionWithDurableError])
    const store = makeStore()

    const created = await store
      .getState()
      .createMission({ name: 'Referral', repoIds: ['r1', 'r2'] })

    expect(created).toEqual(result)
    expect(store.getState().missionMemberErrors[missionMemberErrorKey('m1', 'r2')]).toBe(
      'Branch already exists'
    )
    expect(store.getState().missions).toEqual([missionWithDurableError])
  })

  it('ensureMissionSession refreshes folder workspaces before mission state', async () => {
    const workspace = { id: 'fw-1', missionId: 'm1' }
    missionsApi.ensureSession.mockResolvedValue(workspace)
    missionsApi.list.mockResolvedValue([mission])
    const store = makeStore()

    const result = await store.getState().ensureMissionSession('m1')

    expect(result).toEqual(workspace)
    expect(missionsApi.ensureSession).toHaveBeenCalledWith({ missionId: 'm1' })
    expect(store.getState().fetchFolderWorkspaces).toHaveBeenCalledOnce()
    expect(store.getState().fetchFolderWorkspaces.mock.invocationCallOrder[0]).toBeLessThan(
      missionsApi.list.mock.invocationCallOrder[0]
    )
  })

  it('deleteMission purges the mission session and refreshes both collections on deletion', async () => {
    missionsApi.delete.mockResolvedValue({ deleted: true, memberResults: [] })
    missionsApi.list.mockResolvedValue([])
    const store = makeStore([missionWorkspace])
    store.getState().fetchFolderWorkspaces.mockImplementation(async () => {
      store.setState({ folderWorkspaces: [] })
    })

    const result = await store.getState().deleteMission('m1', true)

    expect(result).toEqual({ deleted: true, memberResults: [] })
    expect(missionsApi.delete).toHaveBeenCalledWith({ missionId: 'm1', deleteWorktrees: true })
    expect(store.getState().purgeWorktreeTerminalState).toHaveBeenCalledWith(['folder:fw-1'])
    expect(store.getState().fetchFolderWorkspaces).toHaveBeenCalledOnce()
    expect(missionsApi.list).toHaveBeenCalledOnce()
  })

  it('deleteMission preserves terminal state until the session workspace is absent after refresh', async () => {
    missionsApi.delete.mockResolvedValue({ deleted: true, memberResults: [] })
    missionsApi.list.mockResolvedValue([])
    const store = makeStore([missionWorkspace])

    await store.getState().deleteMission('m1', true)

    expect(store.getState().fetchFolderWorkspaces).toHaveBeenCalledOnce()
    expect(store.getState().purgeWorktreeTerminalState).not.toHaveBeenCalled()
  })

  it('deleteMission preserves renderer session state when main teardown fails', async () => {
    missionsApi.delete.mockResolvedValue({
      deleted: false,
      memberResults: [],
      error: 'session teardown failed'
    })
    missionsApi.list.mockResolvedValue([mission])
    const store = makeStore([missionWorkspace])

    await store.getState().deleteMission('m1', false)

    expect(store.getState().purgeWorktreeTerminalState).not.toHaveBeenCalled()
    expect(store.getState().fetchFolderWorkspaces).not.toHaveBeenCalled()
    expect(missionsApi.list).toHaveBeenCalledOnce()
  })

  it('removeMissionMember preserves the live Mission session renderer state', async () => {
    missionsApi.removeMember.mockResolvedValue({
      deleted: false,
      memberResults: [{ repoId: 'r1', worktreeId: null }]
    })
    missionsApi.list.mockResolvedValue([mission])
    const store = makeStore([missionWorkspace])

    await store.getState().removeMissionMember('m1', 'r1', true)

    expect(store.getState().purgeWorktreeTerminalState).not.toHaveBeenCalled()
    expect(missionsApi.list).toHaveBeenCalledOnce()
  })

  it('recreate clears the member error when refreshed durable state is clean', async () => {
    missionsApi.recreateMemberWorktree.mockResolvedValue({
      repoId: 'r2',
      worktreeId: 'r2::/wt',
      worktreeInstanceId: 'instance-r2'
    })
    missionsApi.list.mockResolvedValue([mission])
    const store = makeStore()
    store.setState({
      missionMemberErrors: { [missionMemberErrorKey('m1', 'r2')]: 'old' }
    })

    await store.getState().recreateMissionMemberWorktree('m1', 'r2')

    expect(store.getState().missionMemberErrors[missionMemberErrorKey('m1', 'r2')]).toBeUndefined()
  })

  it('keeps a refused top-task removal as an error on that task slot and re-reads layer states', async () => {
    missionsApi.removeTask.mockResolvedValue({ mission, task: null, error: 'mission_task_not_top' })
    missionsApi.list.mockResolvedValue([mission])
    const reports = [{ repoId: 'r1', layers: [{ slot: 'member', state: 'current' }] }]
    missionsApi.inspectStacks.mockResolvedValue(reports)
    const store = makeStore()

    await store.getState().removeMissionTopTask('m1', 'r1', 't1')

    expect(missionsApi.removeTask).toHaveBeenCalledWith({
      missionId: 'm1',
      repoId: 'r1',
      taskId: 't1'
    })
    expect(store.getState().missionSlotErrors[missionSlotErrorKey('m1', 'r1', 'task:t1')]).toBe(
      'mission_task_not_top'
    )
    expect(store.getState().missionStackReports.m1).toEqual(reports)
  })

  it('stores a rejected absorb as the bare error code on the preview slot', async () => {
    missionsApi.absorb.mockRejectedValue(
      new Error("Error invoking remote method 'missions:absorb': Error: mission_absorb_layers_busy")
    )
    missionsApi.list.mockResolvedValue([mission])
    missionsApi.inspectStacks.mockResolvedValue([])
    const store = makeStore()

    const result = await store.getState().absorbMissionPreview('m1', 'r1')

    expect(result).toBeNull()
    expect(store.getState().missionSlotErrors[missionSlotErrorKey('m1', 'r1', 'preview')]).toBe(
      'mission_absorb_layers_busy'
    )
  })

  it('keeps only the newest inspection when an older one resolves later', async () => {
    const older = { repoId: 'r1', layers: [{ slot: 'member', state: 'stale' }] }
    const newer = { repoId: 'r1', layers: [{ slot: 'member', state: 'current' }] }
    let resolveOlder: (reports: unknown[]) => void = () => {}
    missionsApi.inspectStacks
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOlder = resolve)))
      .mockResolvedValueOnce([newer])
    const store = makeStore()

    const first = store.getState().inspectMissionStacks('m1')
    await store.getState().inspectMissionStacks('m1')
    resolveOlder([older])
    await first

    expect(store.getState().missionStackReports.m1).toEqual([newer])
  })

  it('keeps the last reports but marks them outdated when an inspection fails', async () => {
    const reports = [{ repoId: 'r1', layers: [{ slot: 'member', state: 'current' }] }]
    missionsApi.inspectStacks.mockResolvedValueOnce(reports).mockRejectedValueOnce(new Error('git'))
    const store = makeStore()

    await store.getState().inspectMissionStacks('m1')
    await store.getState().inspectMissionStacks('m1')

    expect(store.getState().missionStackReports.m1).toEqual(reports)
    expect(store.getState().missionStackReportsStale.m1).toBe(true)
  })

  it('skips a record-change inspection that a stack action already ran', async () => {
    missionsApi.restack.mockResolvedValue([])
    missionsApi.list.mockResolvedValue([mission])
    missionsApi.inspectStacks.mockResolvedValue([])
    const store = makeStore()

    await store.getState().restackMissionRepo('m1', 'r1')
    await store.getState().inspectMissionStacks('m1', { unlessInspectedSince: mission.updatedAt })

    expect(missionsApi.inspectStacks).toHaveBeenCalledOnce()
  })

  it('surfaces a thrown add-task error as its bare code', async () => {
    missionsApi.addTask.mockRejectedValue(
      new Error(
        "Error invoking remote method 'missions:addTask': Error: mission_task_parent_missing"
      )
    )
    missionsApi.list.mockResolvedValue([mission])
    missionsApi.inspectStacks.mockResolvedValue([])
    const store = makeStore()

    await expect(
      store.getState().addMissionTask('m1', 'r1', { title: 'Coupons' })
    ).resolves.toEqual({
      error: 'mission_task_parent_missing'
    })
  })
})
