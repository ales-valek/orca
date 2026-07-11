import { randomUUID } from 'node:crypto'
import type { FolderWorkspace, WorkspaceKey } from '../../../shared/folder-workspace-types'
import type { Mission } from '../../../shared/mission-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import {
  createMission,
  getNextMissionTabOrder,
  missionSentinelGroupId,
  normalizeMissionName
} from '../../../shared/missions'
import { removeWorkspaceSessionOwnerEverywhere } from '../restoring-sessions/session-owner-removal'
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
      const sessionWorkspace = this.getMissionSessionWorkspace(missionId)
      if (sessionWorkspace) {
        // Why: the session card carries the mission's identity in the sidebar.
        sessionWorkspace.name = mission.name
        sessionWorkspace.updatedAt = Date.now()
      }
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
    this.removeMissionSessionWorkspace(missionId)
    scheduleSave(this[missionPersistenceContext].scheduling)
    return true
  }

  setMissionRootPath(missionId: string, rootPath: string): Mission | null {
    const mission = this.getMission(missionId)
    if (!mission) {
      return null
    }
    mission.rootPath = rootPath
    mission.updatedAt = Date.now()
    scheduleSave(this[missionPersistenceContext].scheduling)
    return mission
  }

  getMissionSessionWorkspace(missionId: string): FolderWorkspace | null {
    return (
      (this[missionPersistenceContext].runtime.state.folderWorkspaces ?? []).find(
        (workspace) => workspace.missionId === missionId
      ) ?? null
    )
  }

  ensureMissionSessionWorkspace(missionId: string): FolderWorkspace {
    const existing = this.getMissionSessionWorkspace(missionId)
    if (existing) {
      return existing
    }
    const mission = this.getMission(missionId)
    if (!mission) {
      throw new Error('mission_not_found')
    }
    if (!mission.rootPath) {
      throw new Error('mission_root_not_ready')
    }
    const now = Date.now()
    const workspace: FolderWorkspace = {
      id: randomUUID(),
      projectGroupId: missionSentinelGroupId(mission.id),
      missionId: mission.id,
      name: mission.name,
      folderPath: mission.rootPath,
      connectionId: null,
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now
    }
    const state = this[missionPersistenceContext].runtime.state
    state.folderWorkspaces = [...(state.folderWorkspaces ?? []), workspace]
    scheduleSave(this[missionPersistenceContext].scheduling)
    return workspace
  }

  private removeMissionSessionWorkspace(missionId: string): void {
    const state = this[missionPersistenceContext].runtime.state
    const sessionWorkspace = this.getMissionSessionWorkspace(missionId)
    if (!sessionWorkspace) {
      return
    }
    const ownerKey = folderWorkspaceKey(sessionWorkspace.id)
    removeWorkspaceSessionOwnerEverywhere(state, ownerKey)
    const lineage = state.workspaceLineageByChildKey
    for (const [childKey, entry] of Object.entries(lineage)) {
      if (entry.parentWorkspaceKey === ownerKey) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: record keys are WorkspaceKey.
        delete lineage[childKey as WorkspaceKey]
      }
    }
    state.folderWorkspaces = (state.folderWorkspaces ?? []).filter(
      (workspace) => workspace.id !== sessionWorkspace.id
    )
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
