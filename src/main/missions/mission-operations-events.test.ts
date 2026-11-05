import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateHostedReviewResult,
  CreateStackedHostedReviewResult
} from '../../shared/source-control/hosted-review/hosted-review-contracts'
import {
  assignOwnedWorktree,
  makeFakeRuntime,
  makeFakeStore,
  missionsBaseDir,
  referralRootPath
} from '../ipc/missions-ipc-test-harness'
import type * as MissionStackPullRequestGitModule from './mission-stack-pull-request-git'

const stackLayerGit = vi.hoisted(() => ({
  getBranchTip: vi.fn(async (_repoPath: string, _branch: string): Promise<string | null> => null),
  getMergeBase: vi.fn(
    async (_repoPath: string, _left: string, _right: string): Promise<string | null> =>
      'parent-base-sha'
  ),
  readLayerWorktree: vi.fn(async (_worktreePath: string) => ({
    branch: null as string | null,
    headSha: null as string | null,
    isClean: true,
    operation: 'unknown' as const
  })),
  rebaseLayerOnto: vi.fn(async () => ({ status: 'rebased' as const })),
  isAncestorCommit: vi.fn(async () => true),
  getCommitAncestry: vi.fn(async (): Promise<boolean | null> => true),
  getForkPoint: vi.fn(async (): Promise<string | null> => null),
  resetPreviewKeep: vi.fn(async () => ({ status: 'moved' as const }))
}))

vi.mock('../git/stack-layer-git', () => stackLayerGit)

const pullRequestGit = vi.hoisted(() => ({
  createLocalMissionStackPullRequestDeps: vi.fn(),
  resolveLocalMissionDefaultBaseBranch: vi.fn(async () => 'main')
}))

vi.mock('./mission-stack-pull-request-git', async (importOriginal) => ({
  ...(await importOriginal<typeof MissionStackPullRequestGitModule>()),
  ...pullRequestGit
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: class {}
}))

import { MissionOperations } from './mission-operations'

function seed() {
  const store = makeFakeStore()
  store.createMission({ name: 'Referral', repoIds: ['r1'] })
  store.setMissionRootPath('m1', referralRootPath, missionsBaseDir)
  assignOwnedWorktree(store, 'r1')
  const runtime = makeFakeRuntime(store)
  const onMissionEvent = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shared Mission IPC fakes implement every store/runtime method these operations call.
  const operations = new MissionOperations(store as never, runtime as never, vi.fn(), {
    onMissionEvent
  })
  return { store, operations, onMissionEvent }
}

function addTask(operations: MissionOperations, externalRef: string) {
  return operations.addTask({ missionId: 'm1', repoId: 'r1', title: 'Form', externalRef })
}

describe('MissionOperations Mission events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports layer-created for a new layer and stack-merged once it reaches main', async () => {
    const { operations, onMissionEvent } = seed()

    const result = await addTask(operations, 'OMP-1')
    await operations.onPullRequestMerged({
      repoPath: path.join(path.sep, 'repos', 'r1'),
      headBranch: 'mission-task/referral/omp-1',
      baseBranch: 'main',
      mergedCount: 1
    })

    const taskIds = [result.task!.id]
    expect(onMissionEvent.mock.calls).toEqual([
      [{ kind: 'layer-created', missionId: 'm1', taskIds }],
      [{ kind: 'stack-merged', missionId: 'm1', taskIds }]
    ])
  })

  it('reports no Mission event for a task that was refused', async () => {
    const { store, operations, onMissionEvent } = seed()
    store.setMissionMemberWorktree('m1', 'r1', null, null)

    await addTask(operations, 'OMP-1')

    expect(onMissionEvent).not.toHaveBeenCalled()
  })

  it('reports stack-pr-created only for task layers that got a new PR', async () => {
    const { operations, onMissionEvent } = seed()
    const first = await addTask(operations, 'OMP-1')
    const second = await addTask(operations, 'OMP-2')
    const taskIds = [first.task!.id, second.task!.id]
    onMissionEvent.mockClear()
    pullRequestGit.createLocalMissionStackPullRequestDeps.mockResolvedValue({
      createHostedReview: async (): Promise<CreateHostedReviewResult> => ({
        ok: false,
        code: 'already_exists',
        error: 'A pull request already exists.',
        existingReview: { url: 'https://github.test/pr/1' }
      }),
      createStackedHostedReview: async (): Promise<CreateStackedHostedReviewResult> => ({
        ok: true,
        number: 2,
        url: 'https://github.test/pr/2',
        stackNumber: 1,
        parentReview: { url: 'https://github.test/pr/1' }
      }),
      getBranchTip: async () => null,
      defaultBaseBranch: 'main',
      getProvider: async () => 'github',
      getCommitsAheadCount: async () => 0,
      pushBranch: async () => {},
      inspectStack: async () => ({
        repoId: 'r1',
        layers: taskIds.map((id) => ({ slot: `task:${id}` as const, state: 'current' as const }))
      })
    })

    const result = await operations.createStackPullRequests({ missionId: 'm1', repoId: 'r1' })

    expect(result.error).toBeUndefined()
    expect(result.skipped).toHaveLength(1)
    expect(onMissionEvent).toHaveBeenCalledExactlyOnceWith({
      kind: 'stack-pr-created',
      missionId: 'm1',
      taskIds: [second.task!.id]
    })
  })
})
