import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'

const readOwnershipMarker = vi.hoisted(() => vi.fn())
const readCreateIntent = vi.hoisted(() => vi.fn())

vi.mock('./mission-worktree-ownership-marker', () => ({
  readMissionWorktreeOwnershipMarker: readOwnershipMarker
}))
vi.mock('./mission-worktree-create-intent', () => ({
  readMissionWorktreeCreateIntent: readCreateIntent
}))

import { assertWorktreeIsNotMissionManaged } from './mission-removal-boundary'

const worktreeId = 'repo-1::/workspaces/member'
const target = { repoPath: '/repos/repo-1', worktreePath: '/workspaces/member' }

function mission(): Mission {
  return {
    id: 'mission-1',
    name: 'Cross repo task',
    branchName: 'mission/cross-repo-task',
    members: [{ repoId: 'repo-1', worktreeId: null, addedAt: 1 }],
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('Mission worktree removal boundary', () => {
  beforeEach(() => {
    readOwnershipMarker.mockReset().mockReturnValue(null)
    readCreateIntent.mockReset().mockReturnValue(null)
  })

  it('blocks generic removal during the add-complete intent-only crash window', () => {
    readCreateIntent.mockReturnValue({
      version: 1,
      missionId: 'mission-1',
      repoId: 'repo-1',
      branchName: 'mission/cross-repo-task',
      worktreePath: target.worktreePath,
      worktreeInstanceId: 'instance-1',
      preserveBranchOnDelete: false
    })
    const liveMission = {
      ...mission(),
      rootBasePath: '/workspaces/missions',
      rootPath: '/workspaces/missions/cross-repo-task'
    }
    const store = {
      getMissions: () => [liveMission],
      getWorktreeMeta: () => undefined
    }

    expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
      'mission_member_managed_by_mission'
    )
    expect(readCreateIntent).toHaveBeenCalledWith(
      {
        baseDir: liveMission.rootBasePath,
        rootPath: liveMission.rootPath,
        missionId: liveMission.id
      },
      'repo-1'
    )
  })

  it('blocks generic removal during the marker-only crash window', () => {
    readOwnershipMarker.mockReturnValue({
      missionId: 'mission-1',
      repoId: 'repo-1',
      worktreeId,
      worktreeInstanceId: 'instance-1'
    })
    const store = {
      getMissions: () => [mission()],
      getWorktreeMeta: () => undefined
    }

    expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
      'mission_member_managed_by_mission'
    )
  })

  it('allows cleanup of a marker orphan after its Mission is durably gone', () => {
    readOwnershipMarker.mockReturnValue({
      missionId: 'mission-1',
      repoId: 'repo-1',
      worktreeId,
      worktreeInstanceId: 'instance-1'
    })
    const store = { getMissions: () => [], getWorktreeMeta: () => undefined }

    expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).not.toThrow()
  })

  it('fails closed when a marker names a different worktree path', () => {
    readOwnershipMarker.mockReturnValue({
      missionId: 'mission-1',
      repoId: 'repo-1',
      worktreeId: 'repo-1::/workspaces/replacement',
      worktreeInstanceId: 'instance-1'
    })
    const store = { getMissions: () => [], getWorktreeMeta: () => undefined }

    expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
      'mission_member_worktree_ownership_unverified'
    )
  })

  describe('non-member slots', () => {
    const taskMission = (): Mission => ({
      ...mission(),
      rootBasePath: '/workspaces/missions',
      rootPath: '/workspaces/missions/cross-repo-task',
      tasks: [
        {
          id: 't1',
          repoId: 'repo-1',
          order: 1,
          title: 'Task',
          branchName: 'mission-task/cross-repo-task/t1',
          worktreeId: null,
          parentBaseSha: null,
          addedAt: 1
        }
      ]
    })

    function intentFor(slot: string) {
      return {
        version: 1,
        missionId: 'mission-1',
        repoId: 'repo-1',
        branchName: 'branch',
        worktreePath: target.worktreePath,
        worktreeInstanceId: 'instance-1',
        preserveBranchOnDelete: false,
        slot
      }
    }

    it.each(['task:t1', 'preview'])(
      'blocks generic removal during the %s intent-only crash window',
      (slot) => {
        readCreateIntent.mockImplementation((_root, _repoId, requested?: string) =>
          requested === slot ? intentFor(slot) : null
        )
        const store = { getMissions: () => [taskMission()], getWorktreeMeta: () => undefined }

        expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
          'mission_member_managed_by_mission'
        )
      }
    )

    it('blocks generic removal of an orchestrator checkout in its intent window', () => {
      readCreateIntent.mockImplementation((_root, repoId: string, requested?: string) =>
        repoId === 'repo-1' && requested === 'orchestrator' ? intentFor('orchestrator') : null
      )
      const orchestrated: Mission = { ...taskMission(), members: [], tasks: [] }
      orchestrated.orchestratorRepoId = 'repo-1'
      const store = { getMissions: () => [orchestrated], getWorktreeMeta: () => undefined }

      expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
        'mission_member_managed_by_mission'
      )
    })

    it.each([
      ['task', { missionSlot: 'task:t1' }, taskMission],
      [
        'orchestrator',
        { missionSlot: 'orchestrator' },
        () => ({
          ...taskMission(),
          members: [],
          tasks: [],
          orchestratorRepoId: 'repo-1'
        })
      ]
    ])('blocks generic removal of a live %s marker', (_kind, slotStamp, makeMission) => {
      readOwnershipMarker.mockReturnValue({
        missionId: 'mission-1',
        repoId: 'repo-1',
        worktreeId,
        worktreeInstanceId: 'instance-1',
        ...slotStamp
      })
      const store = { getMissions: () => [makeMission()], getWorktreeMeta: () => undefined }

      expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
        'mission_member_managed_by_mission'
      )
    })

    it('blocks generic removal of a preview checkout by its live marker alone', () => {
      readOwnershipMarker.mockReturnValue({
        missionId: 'mission-1',
        repoId: 'repo-1',
        worktreeId,
        worktreeInstanceId: 'instance-1',
        missionSlot: 'preview'
      })
      const store = { getMissions: () => [taskMission()], getWorktreeMeta: () => undefined }

      expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId, target)).toThrow(
        'mission_member_managed_by_mission'
      )
      expect(readCreateIntent).toHaveBeenCalled()
    })

    it('blocks generic removal of a worktree a task record points at', () => {
      const pointed = taskMission()
      pointed.tasks![0].worktreeId = worktreeId
      const store = { getMissions: () => [pointed], getWorktreeMeta: () => undefined }

      expect(() => assertWorktreeIsNotMissionManaged(store, worktreeId)).toThrow(
        'mission_member_managed_by_mission'
      )
    })
  })
})
