import { describe, expect, it, vi } from 'vitest'
import type { Mission, MissionTask } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import { emitMissionEvent, getStackPrCreatedTaskIds, MissionEventReporter } from './mission-events'

function createTask(id: string, repoId: string, order: number): MissionTask {
  return {
    id,
    repoId,
    order,
    title: id,
    branchName: `mission-task/kiosek/${id}`,
    worktreeId: null,
    parentBaseSha: null,
    addedAt: 1
  }
}

function createMission(id: string, tasks: MissionTask[]): Mission {
  return {
    id,
    name: id,
    branchName: `mission/${id}`,
    members: [],
    tasks,
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1
  }
}

const MISSION: Mission = {
  ...createMission('m1', [
    createTask('a1', 'r1', 1),
    createTask('a2', 'r1', 2),
    createTask('a3', 'r1', 3),
    createTask('b1', 'r2', 1)
  ]),
  members: [
    { repoId: 'r1', worktreeId: null, addedAt: 1 },
    { repoId: 'r2', worktreeId: null, addedAt: 1 }
  ]
}
const REPO_PATHS: Record<string, string> = { r1: '/repos/one', r2: '/repos/two' }

describe('getStackPrCreatedTaskIds', () => {
  it('maps created PR branches to that repo task layers, never the mission branch', () => {
    expect(
      getStackPrCreatedTaskIds(MISSION, 'r1', [
        { branch: 'mission/m1' },
        { branch: 'mission-task/kiosek/a2' },
        { branch: 'mission-task/kiosek/b1' }
      ])
    ).toEqual(['a2'])
  })
})

function createReporter(missions: Mission[], listener = vi.fn()) {
  const store = {
    getMission: (id: string) => missions.find((mission) => mission.id === id) ?? null,
    getMissions: () => missions,
    getRepo: (id: string): Repo | undefined =>
      REPO_PATHS[id]
        ? { id, path: REPO_PATHS[id], displayName: id, badgeColor: '#000', addedAt: 1 }
        : undefined
  }
  return { listener, reporter: new MissionEventReporter(store, listener, async () => 'main') }
}

function merge(headBranch: string, baseBranch: string, mergedCount = 1) {
  return { repoPath: '/repos/one', headBranch, baseBranch, mergedCount }
}

describe('MissionEventReporter.pullRequestMerged', () => {
  it('reports nothing when a stack merges into the mission branch', async () => {
    const { listener, reporter } = createReporter([MISSION])

    await reporter.pullRequestMerged(merge('mission-task/kiosek/a3', 'mission/m1', 3))

    expect(listener).not.toHaveBeenCalled()
  })

  it('reports every task layer of the repo when the mission branch merges into main', async () => {
    const { listener, reporter } = createReporter([MISSION])

    await reporter.pullRequestMerged(merge('mission/m1', 'main'))

    expect(listener).toHaveBeenCalledExactlyOnceWith({
      kind: 'stack-merged',
      missionId: 'm1',
      taskIds: ['a1', 'a2', 'a3']
    })
  })

  it('reports the merged layers when a task stack merges straight into main', async () => {
    const { listener, reporter } = createReporter([MISSION])

    await reporter.pullRequestMerged(merge('mission-task/kiosek/a2', 'origin/main', 2))

    expect(listener).toHaveBeenCalledExactlyOnceWith({
      kind: 'stack-merged',
      missionId: 'm1',
      taskIds: ['a1', 'a2']
    })
  })

  it('reports nothing when one task PR merges into the layer below it', async () => {
    const { listener, reporter } = createReporter([MISSION])

    await reporter.pullRequestMerged(merge('mission-task/kiosek/a2', 'mission-task/kiosek/a1'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores a branch merged in a different repo or outside any Mission', async () => {
    const { listener, reporter } = createReporter([MISSION])

    await reporter.pullRequestMerged({
      ...merge('mission-task/kiosek/a1', 'main'),
      repoPath: '/repos/two'
    })
    await reporter.pullRequestMerged(merge('feature/other', 'main'))

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('emitMissionEvent', () => {
  it('never lets a failing listener reach the Mission operation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const event = { kind: 'layer-created' as const, missionId: 'm1', taskIds: ['a1'] }

    expect(() =>
      emitMissionEvent(() => {
        throw new Error('sync boom')
      }, event)
    ).not.toThrow()
    emitMissionEvent(async () => {
      throw new Error('async boom')
    }, event)
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2))
    consoleError.mockRestore()
  })
})
