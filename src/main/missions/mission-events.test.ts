import { describe, expect, it, vi } from 'vitest'
import type { Mission, MissionTask } from '../../shared/mission-types'
import {
  emitMissionEvent,
  getMergedMissionEvents,
  getStackPrCreatedTaskIds
} from './mission-events'

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

const MISSION = createMission('m1', [
  createTask('a1', 'r1', 1),
  createTask('a2', 'r1', 2),
  createTask('a3', 'r1', 3),
  createTask('b1', 'r2', 1)
])
const REPO_PATHS: Record<string, string> = { r1: '/repos/one', r2: '/repos/two' }
const getRepoPath = (repoId: string) => REPO_PATHS[repoId] ?? null

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

describe('getMergedMissionEvents', () => {
  it('marks the merged head layer and the layers merged below it', () => {
    expect(
      getMergedMissionEvents([MISSION], getRepoPath, {
        repoPath: '/repos/one',
        headBranch: 'mission-task/kiosek/a3',
        mergedCount: 2
      })
    ).toEqual([{ kind: 'stack-merged', missionId: 'm1', taskIds: ['a2', 'a3'] }])
  })

  it('ignores a branch merged in a different repo or outside any Mission', () => {
    expect(
      getMergedMissionEvents([MISSION], getRepoPath, {
        repoPath: '/repos/two',
        headBranch: 'mission-task/kiosek/a1',
        mergedCount: 1
      })
    ).toEqual([])
    expect(
      getMergedMissionEvents([MISSION], getRepoPath, {
        repoPath: '/repos/one',
        headBranch: 'feature/other',
        mergedCount: 1
      })
    ).toEqual([])
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
