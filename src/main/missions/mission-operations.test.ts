import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MissionSlot } from '../../shared/mission-types'
import {
  assignOwnedWorktree,
  getSetupHookMocks,
  makeFakeRuntime,
  makeFakeStore,
  makeFakeWindow,
  missionsBaseDir,
  referralRootPath
} from '../ipc/missions-ipc-test-harness'

const stackLayerGit = vi.hoisted(() => ({
  getBranchTip: vi.fn(async () => null),
  getMergeBase: vi.fn(async (_repoPath: string, _left: string, _right: string) => 'parent-base-sha')
}))

vi.mock('../git/stack-layer-git', () => stackLayerGit)

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    }
  },
  BrowserWindow: class {}
}))

import { registerMissionHandlers } from '../ipc/missions'
import { MissionOperations } from './mission-operations'
import { MissionMemberOwnershipRecovery } from './mission-member-ownership-recovery'

const setupHookMocks = getSetupHookMocks()

type FakeStore = ReturnType<typeof makeFakeStore>

function createOperations(
  store: FakeStore,
  runtime: ReturnType<typeof makeFakeRuntime>,
  notifyChanged: () => void = vi.fn(),
  runSetupHook?: ConstructorParameters<typeof MissionOperations>[3]
): MissionOperations {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shared Mission IPC fakes implement every store/runtime method these operations call.
  return new MissionOperations(store as never, runtime as never, notifyChanged, runSetupHook)
}

describe('MissionOperations', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  it('runs the setup hook after the Mission root and member worktrees exist', async () => {
    const store = makeFakeStore()
    const runtime = makeFakeRuntime(store)
    const notifyChanged = vi.fn()
    const operations = createOperations(store, runtime, notifyChanged)

    const result = await operations.create({ name: 'Referral', repoIds: ['r1', 'r1'] })

    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledTimes(1)
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', rootPath: referralRootPath }),
      'create'
    )
    expect(runtime.createManagedWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      setupHookMocks.runMissionSetupHook.mock.invocationCallOrder[0]
    )
    expect(notifyChanged).toHaveBeenCalledTimes(2)
    expect(result.mission.rootPath).toBe(referralRootPath)
  })

  it('never fails Mission creation because the setup hook rejects', async () => {
    const store = makeFakeStore()
    const runtime = makeFakeRuntime(store)
    const runSetupHook = vi.fn(async () => {
      throw new Error('hook exploded')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const operations = createOperations(store, runtime, vi.fn(), runSetupHook)

    await expect(operations.create({ name: 'Referral', repoIds: ['r1'] })).resolves.toMatchObject({
      mission: { id: 'm1' }
    })
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
    consoleError.mockRestore()
  })

  it('runs the setup hook with members-added only when new repos joined', async () => {
    const store = makeFakeStore()
    store.createMission({ name: 'Referral', repoIds: ['r1'] })
    assignOwnedWorktree(store, 'r1')
    store.setMissionRootPath('m1', referralRootPath)
    const runtime = makeFakeRuntime(store)
    const operations = createOperations(store, runtime)

    await operations.addMembers({ missionId: 'm1', repoIds: ['r1'] })
    expect(setupHookMocks.runMissionSetupHook).not.toHaveBeenCalled()

    await operations.addMembers({ missionId: 'm1', repoIds: ['r1', 'r2'] })
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledTimes(1)
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'm1',
        members: expect.arrayContaining([expect.objectContaining({ repoId: 'r2' })])
      }),
      'members-added'
    )
  })

  it('is shared with the runtime so `orca mission` RPC reuses IPC locks and notifications', async () => {
    const store = makeFakeStore()
    const runtime = makeFakeRuntime(store)
    const window = makeFakeWindow()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same partial Electron/store/runtime fakes the Mission IPC suite registers with.
    registerMissionHandlers(window as never, store as never, runtime as never)

    expect(runtime.attachMissionOperations).toHaveBeenCalledTimes(1)
    const [operations] = runtime.attachMissionOperations.mock.calls[0]
    if (!(operations instanceof MissionOperations)) {
      throw new Error('expected MissionOperations')
    }

    await operations.create({ name: 'Referral', repoIds: ['r1'] })

    expect(window.webContents.send).toHaveBeenCalledWith('repos:changed')
    expect(handlers.get('missions:list')!({})).toEqual([expect.objectContaining({ id: 'm1' })])
  })
})

describe('MissionMemberOwnershipRecovery slots', () => {
  const taskBranch = 'mission-task/referral/t1'

  function seedMemberAndTask() {
    const store = makeFakeStore()
    store.createMission({ name: 'Referral', repoIds: ['r1'] })
    const member = assignOwnedWorktree(store, 'r1')
    store.addMissionTask('m1', { repoId: 'r1', title: 'T1', branchName: taskBranch })
    const branchById = new Map<string, string>([[member.worktreeId, 'mission/referral']])
    const runtime = makeFakeRuntime(store)
    runtime.inspectManagedWorktreeForOwnership.mockImplementation(async (id: string) => {
      const meta = store.getWorktreeMeta(id)
      return meta?.instanceId
        ? {
            status: 'found' as const,
            worktree: {
              id,
              path: id.slice(id.indexOf('::') + 2),
              repoId: 'r1',
              branch: branchById.get(id) ?? 'unknown',
              instanceId: meta.instanceId
            }
          }
        : { status: 'missing' as const }
    })
    const addTaskWorktree = (name: string, slot: MissionSlot) => {
      const worktreeId = `r1::${path.join(path.sep, 'wt', name)}`
      const worktreeInstanceId = `instance-${name}`
      store.setWorktreeMeta(worktreeId, {
        instanceId: worktreeInstanceId,
        missionId: 'm1',
        missionSlot: slot
      })
      branchById.set(worktreeId, taskBranch)
      return { worktreeId, worktreeInstanceId }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shared Mission IPC fakes implement every store/runtime method recovery calls.
    const recovery = new MissionMemberOwnershipRecovery(store as never, runtime as never)
    return { store, runtime, recovery, member, addTaskWorktree }
  }

  it('recovers each slot of one repo without treating the other slot as ambiguous', async () => {
    const { store, runtime, recovery, member, addTaskWorktree } = seedMemberAndTask()
    const task = addTaskWorktree('r1-task', 'task:task-1')
    const mission = store.getMission('m1')!

    await expect(recovery.recoverLiveOwnedWorktree(mission, 'r1', 'member')).resolves.toEqual(
      member
    )
    await expect(recovery.recoverLiveOwnedWorktree(mission, 'r1', 'task:task-1')).resolves.toEqual(
      task
    )
    expect(runtime.findManagedWorktreesForMissionOwnership).toHaveBeenLastCalledWith(
      'm1',
      'r1',
      taskBranch,
      'task:task-1'
    )
    expect(store.getWorktreeMeta(task.worktreeId)).toMatchObject({ missionSlot: 'task:task-1' })
  })

  it('still refuses two live owners of the same slot', async () => {
    const { store, recovery, addTaskWorktree } = seedMemberAndTask()
    addTaskWorktree('r1-task', 'task:task-1')
    addTaskWorktree('r1-task-copy', 'task:task-1')

    await expect(
      recovery.recoverLiveOwnedWorktree(store.getMission('m1')!, 'r1', 'task:task-1')
    ).rejects.toThrow('mission_member_owned_worktree_ambiguous')
  })

  it('fails closed when the slot has no known branch', async () => {
    const { store, runtime, recovery } = seedMemberAndTask()

    await expect(
      recovery.recoverLiveOwnedWorktree(store.getMission('m1')!, 'r1', 'task:missing')
    ).rejects.toThrow('mission_member_worktree_ownership_unverified')
    expect(runtime.findManagedWorktreesForMissionOwnership).not.toHaveBeenCalled()
  })
})

describe('MissionOperations task layers', () => {
  const taskDir = path.join(referralRootPath, 'repo-one-r1--omp-1')
  const previewDir = path.join(referralRootPath, 'repo-one-r1--preview')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function seed() {
    const store = makeFakeStore()
    store.createMission({ name: 'Referral', repoIds: ['r1'] })
    store.setMissionRootPath('m1', referralRootPath, missionsBaseDir)
    const member = assignOwnedWorktree(store, 'r1')
    const runtime = makeFakeRuntime(store)
    const operations = createOperations(store, runtime)
    return { store, runtime, operations, member }
  }

  function addOmp(operations: MissionOperations, externalRef = 'OMP-1') {
    return operations.addTask({ missionId: 'm1', repoId: 'r1', title: 'Form', externalRef })
  }

  it('creates the first task on the mission branch and a preview on top of it', async () => {
    const { store, runtime, operations } = seed()

    const result = await addOmp(operations)

    expect(result.error).toBeUndefined()
    const taskId = result.task!.id
    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(2)
    expect(runtime.createManagedWorktree).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        branchNameOverride: 'mission-task/referral/omp-1',
        baseBranch: 'mission/referral',
        requireExactBranchName: true,
        missionId: 'm1',
        missionSlot: `task:${taskId}`,
        worktreePathOverride: taskDir
      })
    )
    expect(runtime.createManagedWorktree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        branchNameOverride: 'mission-preview/referral',
        baseBranch: 'mission-task/referral/omp-1',
        missionSlot: 'preview',
        worktreePathOverride: previewDir
      })
    )
    // Why: marker-only recovery needs the task record durable before its checkout exists.
    expect(store.flushPendingOrThrowAsync.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.createManagedWorktree.mock.invocationCallOrder[0]
    )
    expect(stackLayerGit.getMergeBase).toHaveBeenCalledWith(
      path.join(path.sep, 'repos', 'r1'),
      'mission/referral',
      'mission-task/referral/omp-1'
    )
    expect(result.task).toMatchObject({
      worktreeId: `r1::${taskDir}`,
      parentBaseSha: 'parent-base-sha'
    })
    expect(store.getMission('m1')!.previews).toEqual([
      expect.objectContaining({ repoId: 'r1', worktreeId: `r1::${previewDir}` })
    ])
  })

  it('stacks a second task on the first and leaves the preview for restack', async () => {
    const { runtime, operations } = seed()
    await addOmp(operations)
    runtime.createManagedWorktree.mockClear()

    const result = await addOmp(operations, 'OMP-2')

    expect(result.task).toMatchObject({ order: 2, branchName: 'mission-task/referral/omp-2' })
    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(runtime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: 'mission-task/referral/omp-1' })
    )
  })

  it('refuses a task while the member worktree is missing', async () => {
    const { store, runtime, operations } = seed()
    store.setMissionMemberWorktree('m1', 'r1', null, null)

    const result = await addOmp(operations)

    expect(result).toMatchObject({ task: null, error: 'mission_member_worktree_missing' })
    expect(store.getMission('m1')!.tasks ?? []).toEqual([])
    expect(runtime.createManagedWorktree).not.toHaveBeenCalled()
  })

  it('refuses to remove a task that is not on top', async () => {
    const { runtime, operations } = seed()
    const first = await addOmp(operations)
    await addOmp(operations, 'OMP-2')

    const result = await operations.removeTopTask({
      missionId: 'm1',
      repoId: 'r1',
      taskId: first.task!.id,
      deleteWorktree: true
    })

    expect(result.error).toBe('mission_task_not_top')
    expect(runtime.removeManagedWorktree).not.toHaveBeenCalled()
  })

  it('removes the preview together with the last task, preview first', async () => {
    const { store, runtime, operations } = seed()
    const { task } = await addOmp(operations)

    const result = await operations.removeTopTask({
      missionId: 'm1',
      repoId: 'r1',
      deleteWorktree: true
    })

    expect(result.error).toBeUndefined()
    expect(runtime.removeManagedWorktree.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        force: false,
        expectedOwnership: expect.objectContaining({
          worktreeId: `r1::${previewDir}`,
          missionSlot: 'preview'
        })
      }),
      expect.objectContaining({
        force: false,
        expectedOwnership: expect.objectContaining({
          worktreeId: `r1::${taskDir}`,
          missionSlot: `task:${task!.id}`
        })
      })
    ])
    expect(store.getMission('m1')).toMatchObject({ tasks: [], previews: [] })
  })

  it('deletes a Mission top-down: preview, tasks from the top, then the member', async () => {
    const { runtime, operations } = seed()
    await addOmp(operations)
    await addOmp(operations, 'OMP-2')

    const result = await operations.delete({ missionId: 'm1', deleteWorktrees: true })

    expect(result).toMatchObject({ deleted: true })
    expect(runtime.removeManagedWorktree.mock.calls.map((call) => call[0])).toEqual([
      `id:r1::${previewDir}`,
      `id:r1::${path.join(referralRootPath, 'repo-one-r1--omp-2')}`,
      `id:r1::${taskDir}`,
      `id:r1::${path.join(path.sep, 'wt', 'r1')}`
    ])
  })

  it('keeps the Mission when a task layer refuses removal', async () => {
    const { store, runtime, operations } = seed()
    await addOmp(operations)
    runtime.removeManagedWorktree.mockImplementation(async (selector: string) => {
      if (selector === `id:r1::${taskDir}`) {
        throw new Error('worktree_dirty')
      }
      return {}
    })

    const result = await operations.delete({ missionId: 'm1', deleteWorktrees: true })

    expect(result.deleted).toBe(false)
    expect(store.getMission('m1')!.members).toHaveLength(1)
    expect(runtime.removeManagedWorktree).not.toHaveBeenCalledWith(
      `id:r1::${path.join(path.sep, 'wt', 'r1')}`,
      expect.anything()
    )
  })

  it('detaches every slot when a Mission is deleted keeping its worktrees', async () => {
    const { store, operations } = seed()
    await addOmp(operations)
    const ownedBefore = Object.entries(store.getAllWorktreeMeta()).filter(
      ([, meta]) => meta.missionId === 'm1'
    )
    expect(ownedBefore).toHaveLength(3)

    const result = await operations.delete({ missionId: 'm1', deleteWorktrees: false })

    expect(result.deleted).toBe(true)
    for (const [worktreeId] of ownedBefore) {
      expect(store.getWorktreeMeta(worktreeId)?.missionId).toBeUndefined()
    }
  })

  it('refuses to detach a member while its task checkout stays in the Mission root', async () => {
    const { store, operations } = seed()
    await addOmp(operations)
    const mission = store.getMission('m1')!

    const result = await operations.memberLifecycle.detachMember(mission, mission.members[0])

    expect(result.error).toBe('mission_member_workspace_delete_required')
    expect(store.getMission('m1')!.members).toHaveLength(1)
  })
})
