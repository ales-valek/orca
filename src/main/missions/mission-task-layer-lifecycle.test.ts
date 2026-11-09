// @orca-isolated-worker -- harness mocks must not meet a cached mission-root module
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assignOwnedWorktree,
  makeFakeRuntime,
  makeFakeStore,
  missionsBaseDir,
  referralRootPath
} from '../ipc/missions-ipc-test-harness'

const branchTips = vi.hoisted(() => new Map<string, string>())
const previewHead = vi.hoisted(() => ({ sha: '' }))

const stackLayerGit = vi.hoisted(() => ({
  getBranchTip: vi.fn(async (_repoPath: string, branch: string) => branchTips.get(branch) ?? null),
  getMergeBase: vi.fn(async (_repoPath: string, left: string, _right: string) => `${left}-tip`),
  readLayerWorktree: vi.fn(async (_worktreePath: string) => ({
    branch: null as string | null,
    headSha: null as string | null,
    isClean: true,
    operation: 'unknown' as const
  })),
  rebaseLayerOnto: vi.fn(async () => ({ status: 'rebased' as const })),
  isAncestorCommit: vi.fn(async () => false),
  getCommitAncestry: vi.fn(async (): Promise<boolean | null> => true),
  resetPreviewKeep: vi.fn(async (_worktreePath: string, sha: string) => {
    previewHead.sha = sha
    return { status: 'moved' as const }
  })
}))

const branchRefs = vi.hoisted(() => ({
  listLocalBranchesUnder: vi.fn(async (_repoPath: string, _prefix: string) => new Set<string>()),
  deleteOrcaOwnedBranch: vi.fn(async (_repoPath: string, _branch: string) => 'deleted' as const)
}))

vi.mock('../git/stack-layer-git', () => stackLayerGit)
vi.mock('../git/mission-branch-refs', () => branchRefs)

import { MissionOperations } from './mission-operations'

const repoPath = path.join(path.sep, 'repos', 'r1')
const taskDir = (suffix: string) => path.join(referralRootPath, `repo-one-r1--${suffix}`)
const previewDir = taskDir('preview')
const BRANCH = {
  omp1: 'mission-task/referral/omp-1',
  omp2: 'mission-task/referral/omp-2',
  preview: 'mission-preview/referral'
}

function seed() {
  const store = makeFakeStore()
  store.createMission({ name: 'Referral', repoIds: ['r1'] })
  store.setMissionRootPath('m1', referralRootPath, missionsBaseDir)
  assignOwnedWorktree(store, 'r1')
  const runtime = makeFakeRuntime(store)
  const notifyStacksChanged = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shared Mission IPC fakes implement every store/runtime method these operations call.
  const operations = new MissionOperations(store as never, runtime as never, vi.fn(), {
    notifyStacksChanged
  })
  // Why: each layer checkout reports its own branch; the preview reports the tip it last moved to.
  const branchByDir: Record<string, string> = {
    [taskDir('omp-1')]: BRANCH.omp1,
    [taskDir('omp-2')]: BRANCH.omp2,
    [previewDir]: BRANCH.preview
  }
  stackLayerGit.readLayerWorktree.mockImplementation(async (worktreePath: string) => {
    const branch = branchByDir[worktreePath] ?? 'mission/referral'
    return {
      branch,
      headSha: worktreePath === previewDir ? previewHead.sha : (branchTips.get(branch) ?? null),
      isClean: true,
      operation: 'unknown' as const
    }
  })
  return { store, runtime, operations, notifyStacksChanged }
}

function addTask(operations: MissionOperations, externalRef: string) {
  return operations.addTask({ missionId: 'm1', repoId: 'r1', title: 'Form', externalRef })
}

function previewCreates(runtime: ReturnType<typeof makeFakeRuntime>) {
  return runtime.createManagedWorktree.mock.calls
    .map(([args]) => args)
    .filter((args) => args.missionSlot === 'preview')
}

describe('Mission task layer lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    branchTips.clear()
    branchTips.set('mission/referral', 'mission/referral-tip')
    branchTips.set(BRANCH.omp1, `${BRANCH.omp1}-tip`)
    branchTips.set(BRANCH.omp2, `${BRANCH.omp2}-tip`)
    previewHead.sha = `${BRANCH.omp1}-tip`
  })

  it('deletes the preview branch with the last task, then builds a new preview on the next task', async () => {
    const { store, runtime, operations } = seed()
    await addTask(operations, 'OMP-1')
    runtime.removeManagedWorktree.mockImplementation(async (selector: string) =>
      selector === `id:r1::${previewDir}`
        ? { preservedBranch: { branchName: BRANCH.preview, head: `${BRANCH.omp1}-tip` } }
        : {}
    )

    const removed = await operations.removeTopTask({
      missionId: 'm1',
      repoId: 'r1',
      deleteWorktree: true
    })

    expect(removed.error).toBeUndefined()
    expect(removed.warning).toBeUndefined()
    expect(branchRefs.deleteOrcaOwnedBranch).toHaveBeenCalledExactlyOnceWith(
      repoPath,
      BRANCH.preview
    )
    expect(store.getMission('m1')).toMatchObject({ tasks: [], previews: [] })

    // Why: the fake runtime keeps metadata of removed checkouts; real removal drops it.
    for (const dir of [taskDir('omp-1'), previewDir]) {
      store.setWorktreeMeta(`r1::${dir}`, { instanceId: undefined, missionId: undefined })
    }
    // Why: the removed task's branch is kept, so the same ref must pick a free name.
    branchRefs.listLocalBranchesUnder.mockResolvedValueOnce(new Set([BRANCH.omp1]))
    runtime.createManagedWorktree.mockClear()
    const added = await addTask(operations, 'OMP-1')

    expect(added.error).toBeUndefined()
    expect(added.task?.branchName).toBe(`${BRANCH.omp1}-2`)
    expect(branchRefs.listLocalBranchesUnder).toHaveBeenLastCalledWith(
      repoPath,
      'mission-task/referral/'
    )
    expect(previewCreates(runtime)).toEqual([
      expect.objectContaining({
        branchNameOverride: BRANCH.preview,
        baseBranch: `${BRANCH.omp1}-2`
      })
    ])
  })

  it('moves the preview onto the new top task after removing the top of a taller stack', async () => {
    const { operations } = seed()
    await addTask(operations, 'OMP-1')
    await addTask(operations, 'OMP-2')
    expect(previewHead.sha).toBe(`${BRANCH.omp2}-tip`)
    stackLayerGit.resetPreviewKeep.mockClear()

    const result = await operations.removeTopTask({
      missionId: 'm1',
      repoId: 'r1',
      deleteWorktree: true
    })

    expect(result.error).toBeUndefined()
    expect(stackLayerGit.resetPreviewKeep).toHaveBeenCalledExactlyOnceWith(
      previewDir,
      `${BRANCH.omp1}-tip`
    )
    expect(branchRefs.deleteOrcaOwnedBranch).not.toHaveBeenCalled()
  })

  it('recreates a missing task checkout on its existing branch, then restacks', async () => {
    const { store, runtime, operations } = seed()
    const { task } = await addTask(operations, 'OMP-1')
    store.setWorktreeMeta(`r1::${taskDir('omp-1')}`, { instanceId: undefined })
    runtime.createManagedWorktree.mockClear()
    stackLayerGit.readLayerWorktree.mockClear()

    const result = await operations.recreateSlotWorktree({
      missionId: 'm1',
      repoId: 'r1',
      slot: `task:${task!.id}`
    })

    expect(result.error).toBeUndefined()
    expect(runtime.createManagedWorktree).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        branchNameOverride: BRANCH.omp1,
        baseBranch: BRANCH.omp1,
        missionSlot: `task:${task!.id}`,
        worktreePathOverride: taskDir('omp-1')
      })
    )
    expect(stackLayerGit.readLayerWorktree).toHaveBeenCalled()
  })

  it('recreates a task whose branch is gone from its parent and a preview from the top task', async () => {
    const { store, runtime, operations } = seed()
    const { task } = await addTask(operations, 'OMP-1')
    store.setWorktreeMeta(`r1::${taskDir('omp-1')}`, { instanceId: undefined })
    store.setWorktreeMeta(`r1::${previewDir}`, { instanceId: undefined })
    branchTips.delete(BRANCH.omp1)
    branchTips.delete(BRANCH.preview)
    runtime.createManagedWorktree.mockClear()

    await operations.recreateSlotWorktree({
      missionId: 'm1',
      repoId: 'r1',
      slot: `task:${task!.id}`
    })
    await operations.recreateSlotWorktree({ missionId: 'm1', repoId: 'r1', slot: 'preview' })

    expect(runtime.createManagedWorktree.mock.calls.map(([args]) => args)).toEqual([
      expect.objectContaining({ branchNameOverride: BRANCH.omp1, baseBranch: 'mission/referral' }),
      expect.objectContaining({ branchNameOverride: BRANCH.preview, baseBranch: BRANCH.omp1 })
    ])
    expect(store.getMission('m1')!.tasks![0].parentBaseSha).toBe('mission/referral-tip')
  })

  it('reports a stack change after every stack mutation and restack, also when nothing moved', async () => {
    const { operations, notifyStacksChanged } = seed()
    await addTask(operations, 'OMP-1')
    expect(notifyStacksChanged).toHaveBeenLastCalledWith('m1')
    notifyStacksChanged.mockClear()
    // Why: a blocked restack writes no record, so the event is the renderer's only cue.
    stackLayerGit.readLayerWorktree.mockResolvedValue({
      branch: null,
      headSha: null,
      isClean: false,
      operation: 'unknown' as const
    })

    await operations.restack({ missionId: 'm1' })
    await operations.removeTopTask({ missionId: 'm1', repoId: 'r1', deleteWorktree: true })

    expect(notifyStacksChanged.mock.calls).toEqual([['m1'], ['m1']])
  })

  it('refuses to recreate a slot the Mission does not have', async () => {
    const { runtime, operations } = seed()

    const result = await operations.recreateSlotWorktree({
      missionId: 'm1',
      repoId: 'r1',
      slot: 'task:missing'
    })

    expect(result.error).toBe('mission_member_not_found')
    expect(runtime.createManagedWorktree).not.toHaveBeenCalled()
  })
})
