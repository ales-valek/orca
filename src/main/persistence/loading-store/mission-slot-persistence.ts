import { randomUUID } from 'node:crypto'
import type { Mission, MissionSlot, MissionTask } from '../../../shared/mission-types'
import { getTopMissionTask } from '../../../shared/mission-task-stack'
import { applyMissionSlotError, applyMissionSlotWorktree } from './mission-slot-mutations'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type MissionSlotPersistenceRuntime = Pick<StoreRuntimeState, 'state'>

const missionSlotPersistenceContext = Symbol('MissionSlotPersistence')
type MissionSlotPersistenceContext = {
  runtime: MissionSlotPersistenceRuntime
  scheduling: WriteSchedulingOperations
}

export type NewMissionTaskInput = Pick<
  MissionTask,
  'repoId' | 'title' | 'branchName' | 'externalRef' | 'externalId'
>

export class MissionSlotPersistence {
  readonly [missionSlotPersistenceContext]: MissionSlotPersistenceContext

  constructor(runtime: MissionSlotPersistenceRuntime, scheduling: WriteSchedulingOperations) {
    this[missionSlotPersistenceContext] = { runtime, scheduling }
  }

  setMissionMemberWorktree(
    missionId: string,
    repoId: string,
    worktreeId: string | null,
    worktreeInstanceId: string | null = null
  ): Mission | null {
    return this.setMissionSlotWorktree(missionId, repoId, 'member', worktreeId, worktreeInstanceId)
  }

  setMissionMemberError(missionId: string, repoId: string, error: string | null): Mission | null {
    return this.setMissionSlotError(missionId, repoId, 'member', error)
  }

  setMissionSlotWorktree(
    missionId: string,
    repoId: string,
    slot: MissionSlot,
    worktreeId: string | null,
    worktreeInstanceId: string | null = null
  ): Mission | null {
    const mission = this.findMission(missionId)
    if (
      !mission ||
      !applyMissionSlotWorktree(mission, repoId, slot, worktreeId, worktreeInstanceId)
    ) {
      return null
    }
    return this.touchMission(mission)
  }

  setMissionSlotError(
    missionId: string,
    repoId: string,
    slot: MissionSlot,
    error: string | null
  ): Mission | null {
    const mission = this.findMission(missionId)
    if (!mission || !applyMissionSlotError(mission, repoId, slot, error)) {
      return null
    }
    return this.touchMission(mission)
  }

  addMissionTask(missionId: string, input: NewMissionTaskInput): MissionTask | null {
    const mission = this.findMission(missionId)
    if (!mission || !mission.members.some((member) => member.repoId === input.repoId)) {
      return null
    }
    const task: MissionTask = {
      ...input,
      id: randomUUID(),
      order: (getTopMissionTask(mission, input.repoId)?.order ?? 0) + 1,
      worktreeId: null,
      worktreeInstanceId: null,
      parentBaseSha: null,
      lastError: null,
      addedAt: Date.now()
    }
    mission.tasks = [...(mission.tasks ?? []), task]
    this.touchMission(mission)
    return task
  }

  removeMissionTask(missionId: string, taskId: string): Mission | null {
    const mission = this.findMission(missionId)
    const task = mission?.tasks?.find((entry) => entry.id === taskId)
    if (!mission || !task) {
      return null
    }
    if (getTopMissionTask(mission, task.repoId)?.id !== task.id) {
      throw new Error('mission_task_not_top')
    }
    mission.tasks = (mission.tasks ?? []).filter((entry) => entry.id !== taskId)
    return this.touchMission(mission)
  }

  setMissionTaskParentBaseSha(missionId: string, taskId: string, sha: string): Mission | null {
    const mission = this.findMission(missionId)
    const task = mission?.tasks?.find((entry) => entry.id === taskId)
    if (!mission || !task) {
      return null
    }
    task.parentBaseSha = sha
    return this.touchMission(mission)
  }

  private findMission(missionId: string): Mission | null {
    return (
      (this[missionSlotPersistenceContext].runtime.state.missions ?? []).find(
        (mission) => mission.id === missionId
      ) ?? null
    )
  }

  private touchMission(mission: Mission): Mission {
    mission.updatedAt = Date.now()
    scheduleSave(this[missionSlotPersistenceContext].scheduling)
    return mission
  }
}
