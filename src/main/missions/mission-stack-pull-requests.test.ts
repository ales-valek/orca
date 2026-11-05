import { describe, expect, it, vi } from 'vitest'
import type { CreateHostedReviewResult } from '../../shared/source-control/hosted-review/hosted-review-contracts'
import type { CreateStackedHostedReviewResult } from '../../shared/source-control/hosted-review/hosted-review-contracts'
import type { Mission } from '../../shared/mission-types'
import {
  createMissionStackPullRequests,
  pushMissionStack,
  type MissionStackPullRequestDeps,
  type MissionStackPushDeps
} from './mission-stack-pull-requests'

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [{ repoId: 'r1', worktreeId: 'r1::/wt/member', addedAt: 0 }],
  tasks: [
    task('t1', 1, 'mission-task/referral/omp-1', 'OMP-1', 'First'),
    task('t2', 2, 'mission-task/referral/second', null, 'Second')
  ],
  tabOrder: 0,
  createdAt: 0,
  updatedAt: 0
}

function task(
  id: string,
  order: number,
  branchName: string,
  externalRef: string | null,
  title: string
) {
  return {
    id,
    repoId: 'r1',
    order,
    title,
    branchName,
    worktreeId: `r1::/wt/${id}`,
    parentBaseSha: null,
    externalRef,
    addedAt: 0
  }
}

function plainOk(n: number): CreateHostedReviewResult {
  return { ok: true, number: n, url: `https://github.com/o/r/pull/${n}` }
}

function stackedOk(n: number): CreateStackedHostedReviewResult {
  return {
    ok: true,
    number: n,
    url: `https://github.com/o/r/pull/${n}`,
    stackNumber: 1,
    parentReview: { number: 1, url: 'u' }
  }
}

function createDeps(overrides: Partial<MissionStackPullRequestDeps> = {}) {
  let next = 0
  const calls: string[] = []
  const deps: MissionStackPullRequestDeps = {
    createHostedReview: vi.fn(async (_path, input) => {
      calls.push(`plain ${input.head} -> ${input.base}`)
      return plainOk(++next)
    }),
    createStackedHostedReview: vi.fn(async (_path, input) => {
      calls.push(`stacked ${input.head} -> ${input.base}`)
      return stackedOk(++next)
    }),
    getBranchTip: vi.fn(async () => 'a'.repeat(40)),
    defaultBaseBranch: 'main',
    getProvider: async () => 'github',
    getCommitsAheadCount: vi.fn(async () => 1),
    pushBranch: vi.fn(async () => undefined),
    inspectStack: vi.fn(async () => ({
      repoId: 'r1',
      layers: [
        { slot: 'member' as const, state: 'current' as const },
        { slot: 'task:t1' as const, state: 'needs-push' as const },
        { slot: 'task:t2' as const, state: 'current' as const }
      ]
    })),
    ...overrides
  }
  return { deps, calls }
}

describe('createMissionStackPullRequests', () => {
  it('opens the mission PR first when the mission branch is ahead of the default base', async () => {
    const { deps, calls } = createDeps()

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(calls).toEqual([
      'plain mission/referral -> main',
      'plain mission-task/referral/omp-1 -> mission/referral',
      'stacked mission-task/referral/second -> mission-task/referral/omp-1'
    ])
    expect(result.error).toBeUndefined()
    expect(result.created.map((entry) => entry.branch)).toEqual([
      'mission/referral',
      'mission-task/referral/omp-1',
      'mission-task/referral/second'
    ])
    expect(vi.mocked(deps.pushBranch).mock.calls.map(([branch]) => branch)).toEqual(
      result.created.map((entry) => entry.branch)
    )
  })

  it('skips the mission PR and targets the default base when the mission branch is not ahead', async () => {
    const { deps, calls } = createDeps({
      getCommitsAheadCount: vi.fn(async () => 0)
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(calls).toEqual([
      'plain mission-task/referral/omp-1 -> main',
      'stacked mission-task/referral/second -> mission-task/referral/omp-1'
    ])
    expect(result.created).toHaveLength(2)
    expect(vi.mocked(deps.pushBranch)).not.toHaveBeenCalledWith('mission/referral')
  })

  it('titles task PRs with their external ref and the mission PR with the mission name', async () => {
    const { deps } = createDeps()

    await createMissionStackPullRequests({ mission, repoId: 'r1', draft: true }, deps)

    const calls = [
      ...vi.mocked(deps.createHostedReview).mock.calls,
      ...vi.mocked(deps.createStackedHostedReview).mock.calls
    ].map(([, input]) => [input.head, input.title, input.draft, input.useTemplate])
    expect(calls).toEqual([
      ['mission/referral', 'Referral', true, true],
      ['mission-task/referral/omp-1', 'OMP-1: First', true, true],
      ['mission-task/referral/second', 'Second', true, true]
    ])
  })

  it('stops at the first failure and reports what was already created', async () => {
    const { deps } = createDeps({
      createHostedReview: vi.fn().mockResolvedValueOnce(plainOk(1)).mockResolvedValueOnce({
        ok: false,
        code: 'validation',
        error: 'dirty worktree'
      })
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result.created.map((entry) => entry.branch)).toEqual(['mission/referral'])
    expect(result.error).toContain('dirty worktree')
    expect(deps.createStackedHostedReview).not.toHaveBeenCalled()
  })

  it('skips a layer whose open PR already exists and continues', async () => {
    const { deps } = createDeps({
      createHostedReview: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          code: 'already_exists',
          error: 'exists',
          existingReview: { number: 9, url: 'u' }
        })
        .mockResolvedValueOnce(plainOk(2))
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result.error).toBeUndefined()
    expect(result.skipped).toEqual([{ branch: 'mission/referral', url: 'u' }])
    expect(result.created.map((entry) => entry.branch)).toEqual([
      'mission-task/referral/omp-1',
      'mission-task/referral/second'
    ])
  })

  it('keeps the PRs created so far when a later creation call throws', async () => {
    const { deps } = createDeps({
      createStackedHostedReview: vi.fn().mockRejectedValue(new Error('gh exploded'))
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result.created.map((entry) => entry.branch)).toEqual([
      'mission/referral',
      'mission-task/referral/omp-1'
    ])
    expect(result.error).toContain('gh exploded')
  })

  it('refuses non-GitHub providers without pushing', async () => {
    const { deps } = createDeps({ getProvider: async () => 'gitlab' })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result).toEqual({
      created: [],
      skipped: [],
      error: 'mission_stack_prs_unsupported_provider'
    })
    expect(deps.pushBranch).not.toHaveBeenCalled()
  })

  it('refuses before the first push while a task layer is not current, listing the layers', async () => {
    const { deps } = createDeps({
      inspectStack: vi.fn(async () => ({
        repoId: 'r1',
        layers: [
          { slot: 'member' as const, state: 'current' as const },
          { slot: 'task:t1' as const, state: 'stale' as const }
        ]
      }))
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result.error).toBe(
      'mission_stack_not_current: mission-task/referral/omp-1 (stale), mission-task/referral/second (unknown)'
    )
    expect(deps.pushBranch).not.toHaveBeenCalled()
    expect(deps.createHostedReview).not.toHaveBeenCalled()
  })

  it('keeps the raw message when the remote itself rejects the push', async () => {
    const message =
      ' ! [remote rejected] mission/referral -> mission/referral (protected branch hook declined)'
    const { deps } = createDeps({
      pushBranch: vi.fn().mockRejectedValueOnce(new Error(message))
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result.error).toBe(`mission/referral: ${message}`)
  })

  it('reports a push failure and creates nothing further', async () => {
    const { deps } = createDeps({
      pushBranch: vi
        .fn()
        .mockRejectedValueOnce(new Error(' ! [rejected] mission/referral (fetch first)'))
    })

    const result = await createMissionStackPullRequests({ mission, repoId: 'r1' }, deps)

    expect(result.created).toEqual([])
    expect(result.error).toBe('Layer mission/referral was rewritten; push the stack first')
    expect(deps.createHostedReview).not.toHaveBeenCalled()
  })
})

describe('pushMissionStack', () => {
  const missionTip = 'm'.repeat(40)
  const t1Tip = '1'.repeat(40)
  const t2Tip = '2'.repeat(40)
  const oldTip = 'o'.repeat(40)
  const localTips: Record<string, string> = {
    'mission/referral': missionTip,
    'mission-task/referral/omp-1': t1Tip,
    'mission-task/referral/second': t2Tip
  }
  const stackWithBases: Mission = {
    ...mission,
    tasks: [
      { ...mission.tasks![0], parentBaseSha: missionTip },
      { ...mission.tasks![1], parentBaseSha: t1Tip }
    ]
  }

  function pushDeps(remoteTips: Record<string, string | null>): MissionStackPushDeps {
    return {
      getBranchTip: vi.fn(async (_path: string, branch: string) => localTips[branch] ?? null),
      getRemoteTrackingTip: vi.fn(async (branch: string) => remoteTips[branch] ?? null),
      pushBranch: vi.fn(async () => undefined),
      getCommitAncestry: vi.fn(async () => false)
    }
  }

  it('force-pushes with a lease only the layers whose pushed tip is behind their local tip', async () => {
    const deps = pushDeps({
      'mission/referral': missionTip,
      'mission-task/referral/omp-1': oldTip,
      'mission-task/referral/second': null
    })

    const result = await pushMissionStack({ mission: stackWithBases, repoId: 'r1' }, deps)

    expect(result).toEqual({ pushed: ['mission-task/referral/omp-1'] })
    expect(deps.pushBranch).toHaveBeenCalledTimes(1)
    expect(deps.pushBranch).toHaveBeenCalledWith('mission-task/referral/omp-1', oldTip)
  })

  it('never pushes a layer whose remote branch is ahead of the local one', async () => {
    const remoteAhead = 'r'.repeat(40)
    const deps = pushDeps({
      'mission/referral': missionTip,
      'mission-task/referral/omp-1': remoteAhead
    })
    vi.mocked(deps.getCommitAncestry).mockImplementation(
      async (ancestor, descendant) => ancestor === t1Tip && descendant === remoteAhead
    )

    const result = await pushMissionStack({ mission: stackWithBases, repoId: 'r1' }, deps)

    expect(result).toEqual({ pushed: [] })
    expect(deps.pushBranch).not.toHaveBeenCalled()
  })

  it('stops at the first push failure', async () => {
    const deps = pushDeps({
      'mission/referral': oldTip,
      'mission-task/referral/omp-1': oldTip,
      'mission-task/referral/second': oldTip
    })
    vi.mocked(deps.pushBranch).mockRejectedValueOnce(new Error('stale info'))

    const result = await pushMissionStack({ mission: stackWithBases, repoId: 'r1' }, deps)

    expect(result.pushed).toEqual([])
    expect(result.error).toContain('stale info')
    expect(deps.pushBranch).toHaveBeenCalledTimes(1)
  })
})
