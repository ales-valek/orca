import type { Mission } from '../../../shared/mission-types'
import {
  createMission,
  getNextMissionTabOrder,
  normalizeMissionName
} from '../../../shared/missions'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type MissionPersistenceRuntime = Pick<StoreRuntimeState, 'state'>

const missionPersistenceContext = Symbol('MissionPersistence')
type MissionPersistenceContext = {
  runtime: MissionPersistenceRuntime
  scheduling: WriteSchedulingOperations
}

export class MissionPersistence {
  readonly [missionPersistenceContext]: MissionPersistenceContext

  constructor(runtime: MissionPersistenceRuntime, scheduling: WriteSchedulingOperations) {
    this[missionPersistenceContext] = { runtime, scheduling }
  }

  getMissions(): Mission[] {
    return [...(this[missionPersistenceContext].runtime.state.missions ?? [])].sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  getMission(missionId: string): Mission | null {
    return (
      (this[missionPersistenceContext].runtime.state.missions ?? []).find(
        (mission) => mission.id === missionId
      ) ?? null
    )
  }

  createMission(input: { name: string; branchName?: string | null; repoIds: string[] }): Mission {
    const mission = createMission({
      ...input,
      tabOrder: getNextMissionTabOrder(this[missionPersistenceContext].runtime.state.missions ?? [])
    })
    this[missionPersistenceContext].runtime.state.missions = [
      ...(this[missionPersistenceContext].runtime.state.missions ?? []),
      mission
    ]
    scheduleSave(this[missionPersistenceContext].scheduling)
    return mission
  }

  updateMission(
    missionId: string,
    updates: Partial<Pick<Mission, 'name' | 'tabOrder'>>
  ): Mission | null {
    const mission = this.getMission(missionId)
    if (!mission) {
      return null
    }
    if (updates.name !== undefined) {
      mission.name = normalizeMissionName(updates.name, mission.name)
    }
    if (updates.tabOrder !== undefined && Number.isFinite(updates.tabOrder)) {
      mission.tabOrder = updates.tabOrder
    }
    mission.updatedAt = Date.now()
    scheduleSave(this[missionPersistenceContext].scheduling)
    return mission
  }

  deleteMission(missionId: string): boolean {
    const state = this[missionPersistenceContext].runtime.state
    const before = state.missions?.length ?? 0
    state.missions = (state.missions ?? []).filter((mission) => mission.id !== missionId)
    if ((state.missions?.length ?? 0) === before) {
      return false
    }
    scheduleSave(this[missionPersistenceContext].scheduling)
    return true
  }

  addMissionMembers(missionId: string, repoIds: string[]): Mission | null {
    const mission = this.getMission(missionId)
    if (!mission) {
      return null
    }
    const now = Date.now()
    const existing = new Set(mission.members.map((member) => member.repoId))
    for (const repoId of repoIds) {
      if (!repoId || existing.has(repoId)) {
        continue
      }
      existing.add(repoId)
      mission.members.push({ repoId, worktreeId: null, addedAt: now })
    }
    mission.updatedAt = now
    scheduleSave(this[missionPersistenceContext].scheduling)
    return mission
  }

  removeMissionMember(missionId: string, repoId: string): Mission | null {
    const mission = this.getMission(missionId)
    if (!mission) {
      return null
    }
    mission.members = mission.members.filter((member) => member.repoId !== repoId)
    mission.updatedAt = Date.now()
    scheduleSave(this[missionPersistenceContext].scheduling)
    return mission
  }

  setMissionMemberWorktree(
    missionId: string,
    repoId: string,
    worktreeId: string | null
  ): Mission | null {
    const mission = this.getMission(missionId)
    if (!mission) {
      return null
    }
    const member = mission.members.find((entry) => entry.repoId === repoId)
    if (!member) {
      return null
    }
    member.worktreeId = worktreeId
    mission.updatedAt = Date.now()
    scheduleSave(this[missionPersistenceContext].scheduling)
    return mission
  }
}
