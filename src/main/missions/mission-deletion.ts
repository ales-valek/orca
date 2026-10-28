import type {
  Mission,
  MissionDeleteResult,
  MissionMember,
  MissionMemberResult
} from '../../shared/mission-types'
import type { Store } from '../persistence'
import type { MissionMemberLifecycle } from './mission-member-lifecycle'
import { removeMissionRootIfPresent, syncMissionRootIfPresent } from './mission-root-sync'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type MissionDeletionDeps = {
  store: Store
  memberLifecycle: MissionMemberLifecycle
  notifyChanged: () => void
  removeMemberWithLayers: (mission: Mission, member: MissionMember) => Promise<MissionMemberResult>
}

/** Deletes a Mission, removing or detaching every worktree it owns. Caller holds the Mission run lock. */
export class MissionDeletion {
  constructor(private readonly deps: MissionDeletionDeps) {}

  async delete(mission: Mission, deleteWorktrees: boolean): Promise<MissionDeleteResult> {
    try {
      // Why: the Mission PTY may have a cwd inside a link; stop it before unlinking.
      await this.deps.memberLifecycle.teardownSession(mission)
    } catch (error) {
      return {
        deleted: false,
        memberResults: [],
        error: toErrorMessage(error)
      }
    }
    return deleteWorktrees
      ? this.deleteWithWorktrees(mission)
      : this.deleteDetachingWorktrees(mission)
  }

  private async deleteDetachingWorktrees(mission: Mission): Promise<MissionDeleteResult> {
    const { store, memberLifecycle } = this.deps
    let rootWarning: string | undefined, recoveredMission: Mission, deleted: boolean
    try {
      // Why: a create intent may be the only proof after Git add. Promote
      // it through a strict scan before root cleanup can remove that proof.
      recoveredMission = await memberLifecycle.recoverMembersBeforeMissionDetach(mission)
      const rootResult = removeMissionRootIfPresent(store, recoveredMission)
      if (rootResult && !rootResult.removed && mission.rootPath) {
        rootWarning = `Preserved files in the former Mission root: ${mission.rootPath}`
      }
      // Why: marker removal is safe only after Mission/session deletion is durable.
      deleted = await store.deleteMissionAndFlush(mission.id)
    } catch (error) {
      return {
        deleted: false,
        memberResults: [],
        error: toErrorMessage(error)
      }
    }
    if (deleted) {
      memberLifecycle.detachDeletedMissionOwnership(recoveredMission)
    }
    this.deps.notifyChanged()
    return {
      deleted,
      memberResults: [],
      ...(rootWarning ? { warning: rootWarning } : {})
    }
  }

  private async deleteWithWorktrees(mission: Mission): Promise<MissionDeleteResult> {
    const { store } = this.deps
    const memberResults: MissionMemberResult[] = []
    // Why: removeWorktree reassigns members; iterate a snapshot so removals don't skip entries.
    const members = [...mission.members]
    for (const member of members) {
      memberResults.push(await this.deps.removeMemberWithLayers(mission, member))
    }
    const orchestratorResult = mission.orchestratorRepoId
      ? await this.deps.memberLifecycle.removeSlotWorktree(
          store.getMission(mission.id) ?? mission,
          mission.orchestratorRepoId,
          'orchestrator',
          true
        )
      : undefined
    const orchestratorFields = orchestratorResult ? { orchestratorResult } : {}
    const remaining = store.getMission(mission.id)
    // Why: keep a Mission with an undeletable worktree visible for a safe retry.
    let deleted = false
    let rootWarning: string | undefined
    if (remaining !== null && remaining.members.length === 0 && !orchestratorResult?.error) {
      try {
        const rootResult = removeMissionRootIfPresent(store, mission)
        if (rootResult && !rootResult.removed && mission.rootPath) {
          rootWarning = `Preserved files in the former Mission root: ${mission.rootPath}`
        }
        deleted = store.deleteMission(mission.id)
      } catch (error) {
        return {
          deleted: false,
          memberResults,
          ...orchestratorFields,
          error: toErrorMessage(error)
        }
      }
    }
    if (!deleted) {
      syncMissionRootIfPresent(store, mission.id)
    }
    this.deps.notifyChanged()
    const warnings = [
      ...memberResults,
      ...(orchestratorResult ? [orchestratorResult] : [])
    ].flatMap((result) => result.warning ?? [])
    if (rootWarning) {
      warnings.push(rootWarning)
    }
    return {
      deleted,
      memberResults,
      ...orchestratorFields,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {})
    }
  }
}
