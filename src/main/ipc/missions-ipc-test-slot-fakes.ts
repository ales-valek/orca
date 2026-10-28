import { vi } from 'vitest'
import type { Mission, MissionSlot, MissionTask } from '../../shared/mission-types'
import { getTopMissionTask } from '../../shared/mission-task-stack'
import {
  applyMissionSlotError,
  applyMissionSlotWorktree
} from '../persistence/loading-store/mission-slot-mutations'
import type { FakeMissionTaskInput } from './missions-ipc-test-contracts'

export function createFakeSlotStoreMethods(getMission: () => Mission | null) {
  let nextTaskNumber = 1
  return {
    setMissionSlotWorktree: vi.fn(
      (
        _id: string,
        repoId: string,
        slot: MissionSlot,
        worktreeId: string | null,
        worktreeInstanceId: string | null = null
      ) => {
        const mission = getMission()
        return mission &&
          applyMissionSlotWorktree(mission, repoId, slot, worktreeId, worktreeInstanceId)
          ? mission
          : null
      }
    ),
    setMissionSlotError: vi.fn(
      (_id: string, repoId: string, slot: MissionSlot, error: string | null) => {
        const mission = getMission()
        return mission && applyMissionSlotError(mission, repoId, slot, error) ? mission : null
      }
    ),
    addMissionTask: vi.fn((_id: string, input: FakeMissionTaskInput) => {
      const mission = getMission()
      if (!mission?.members.some((member) => member.repoId === input.repoId)) {
        return null
      }
      const task: MissionTask = {
        ...input,
        id: `task-${nextTaskNumber++}`,
        order: (getTopMissionTask(mission, input.repoId)?.order ?? 0) + 1,
        worktreeId: null,
        worktreeInstanceId: null,
        parentBaseSha: null,
        lastError: null,
        addedAt: 1
      }
      mission.tasks = [...(mission.tasks ?? []), task]
      return task
    }),
    removeMissionTask: vi.fn((_id: string, taskId: string) => {
      const mission = getMission()
      const task = mission?.tasks?.find((entry) => entry.id === taskId)
      if (!mission || !task) {
        return null
      }
      if (getTopMissionTask(mission, task.repoId)?.id !== task.id) {
        throw new Error('mission_task_not_top')
      }
      mission.tasks = (mission.tasks ?? []).filter((entry) => entry.id !== taskId)
      return mission
    }),
    setMissionTaskParentBaseSha: vi.fn((_id: string, taskId: string, sha: string) => {
      const mission = getMission()
      const task = mission?.tasks?.find((entry) => entry.id === taskId)
      if (task) {
        task.parentBaseSha = sha
      }
      return mission
    })
  }
}
