import type {
  Mission,
  MissionMember,
  MissionMemberResult,
  MissionSlot
} from '../../shared/mission-types'
import { getRepoTaskStack } from '../../shared/mission-task-stack'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { MissionMemberOwnershipRecovery } from './mission-member-ownership-recovery'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import {
  getMissionSlotDirectoryName,
  isInMissionRoot,
  MissionSlotWorktrees,
  type MissionSlotWorktreeOptions
} from './mission-slot-worktrees'
import {
  findMissionRepoOwnedWorktrees,
  getMissionOwnedWorktree,
  getMissionRepoSlots,
  getMissionSlotRecord,
  type MissionOwnedWorktree
} from './mission-worktree-ownership'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class MissionMemberLifecycle {
  private readonly operationTails = new Map<string, Promise<void>>()
  private readonly ownershipRecovery: MissionMemberOwnershipRecovery
  private readonly slotWorktrees: MissionSlotWorktrees

  constructor(
    private readonly store: Store,
    private readonly runtime: OrcaRuntimeService
  ) {
    this.ownershipRecovery = new MissionMemberOwnershipRecovery(store, runtime)
    this.slotWorktrees = new MissionSlotWorktrees(store, runtime, this.ownershipRecovery)
  }

  run<T>(missionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(missionId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const tail = current.then(
      () => undefined,
      () => undefined
    )
    this.operationTails.set(missionId, tail)
    void tail.finally(() => {
      if (this.operationTails.get(missionId) === tail) {
        this.operationTails.delete(missionId)
      }
    })
    return current
  }

  createSlotWorktree(
    mission: Mission,
    repoId: string,
    slot: MissionSlot,
    opts: MissionSlotWorktreeOptions
  ): Promise<MissionMemberResult> {
    return this.slotWorktrees.create(mission, repoId, slot, opts)
  }

  createWorktree(mission: Mission, repoId: string): Promise<MissionMemberResult> {
    const displayName = this.store.getRepo(repoId)?.displayName ?? repoId
    return this.createSlotWorktree(mission, repoId, 'member', {
      branchName: mission.branchName,
      directoryName: getMissionSlotDirectoryName(displayName, repoId)
    })
  }

  /** The orchestrator checks out the mission branch itself, like a member. */
  createOrchestratorWorktree(
    mission: Mission,
    repoId: string,
    options: { baseBranch?: string } = {}
  ): Promise<MissionMemberResult> {
    const displayName = this.store.getRepo(repoId)?.displayName ?? repoId
    return this.createSlotWorktree(mission, repoId, 'orchestrator', {
      branchName: mission.branchName,
      ...options,
      directoryName: `${getMissionSlotDirectoryName(displayName, repoId)}--orchestrator`
    })
  }

  removeSlotWorktree(
    mission: Mission,
    repoId: string,
    slot: Exclude<MissionSlot, 'member'>,
    deleteWorktree: boolean
  ): Promise<MissionMemberResult> {
    return this.slotWorktrees.remove(mission, repoId, slot, deleteWorktree)
  }

  // Why: parallel create calls can contend on Git locks; deterministic member
  // ordering also makes partial results and retry behavior stable.
  async createWorktrees(mission: Mission, repoIds: string[]): Promise<MissionMemberResult[]> {
    const results: MissionMemberResult[] = []
    for (const repoId of repoIds) {
      results.push(await this.createWorktree(mission, repoId))
    }
    return results
  }

  async removeWorktree(mission: Mission, member: MissionMember): Promise<MissionMemberResult> {
    try {
      requireNativeLocalMissionRepos(this.store, [member.repoId])
      // Why: a crash can stamp ownership before the member pointer is saved.
      // Resolve the durable candidate before removing the member record.
      const owned = await this.ownershipRecovery.recoverLiveOwnedWorktree(mission, member.repoId)
      if (!owned) {
        const recorded = getMissionOwnedWorktree(this.store, mission, member)
        if ((member.worktreeId || member.worktreeInstanceId) && !recorded) {
          await this.ownershipRecovery.clearStrictlyMissingMemberPointer(mission, member)
        }
        this.store.removeMissionMember(mission.id, member.repoId)
        return { repoId: member.repoId, worktreeId: null }
      }
      if (
        member.worktreeId !== owned.worktreeId ||
        member.worktreeInstanceId !== owned.worktreeInstanceId
      ) {
        this.store.setMissionMemberWorktree(
          mission.id,
          member.repoId,
          owned.worktreeId,
          owned.worktreeInstanceId
        )
      }
      const warning = await this.slotWorktrees.removeOwned(mission, member.repoId, 'member', owned)
      this.store.removeMissionMember(mission.id, member.repoId)
      return { repoId: member.repoId, worktreeId: null, ...(warning ? { warning } : {}) }
    } catch (error) {
      const message = toErrorMessage(error)
      this.store.setMissionMemberError(mission.id, member.repoId, message)
      return { repoId: member.repoId, worktreeId: member.worktreeId, error: message }
    }
  }

  async detachMember(mission: Mission, member: MissionMember): Promise<MissionMemberResult> {
    try {
      requireNativeLocalMissionRepos(this.store, [member.repoId])
      const owned = await this.ownershipRecovery.recoverLiveOwnedWorktree(mission, member.repoId)
      if (!owned) {
        const recorded = getMissionOwnedWorktree(this.store, mission, member)
        if ((member.worktreeId || member.worktreeInstanceId) && !recorded) {
          await this.ownershipRecovery.clearStrictlyMissingMemberPointer(mission, member)
        }
      }
      if (
        (owned && isInMissionRoot(mission, owned)) ||
        (await this.slotWorktrees.hasNonMemberCheckoutInRoot(mission, member.repoId))
      ) {
        // Why: leaving a physical child behind would keep the removed repo
        // visible and writable from the still-active Mission session.
        throw new Error('mission_member_workspace_delete_required')
      }
      this.detachOwnership(mission, member.repoId)
      this.pruneLayerRecords(mission.id, member.repoId)
      this.store.removeMissionMember(mission.id, member.repoId)
      return { repoId: member.repoId, worktreeId: null }
    } catch (error) {
      const message = toErrorMessage(error)
      this.store.setMissionMemberError(mission.id, member.repoId, message)
      return { repoId: member.repoId, worktreeId: member.worktreeId, error: message }
    }
  }

  recoverMembersBeforeMissionDetach(mission: Mission): Promise<Mission> {
    return this.ownershipRecovery.recoverMembersBeforeMissionDetach(mission)
  }

  detachDeletedMissionOwnership(mission: Mission): void {
    const repoIds = new Set(mission.members.map((member) => member.repoId))
    if (mission.orchestratorRepoId) {
      repoIds.add(mission.orchestratorRepoId)
    }
    for (const repoId of repoIds) {
      this.detachOwnership(mission, repoId)
    }
  }

  /** Clears Mission ownership of every slot's worktree in the repo; checkouts stay. */
  detachOwnership(mission: Mission, repoId: string): void {
    const candidates = new Map<string, MissionOwnedWorktree>()
    for (const slot of getMissionRepoSlots(mission, repoId)) {
      const record = getMissionSlotRecord(mission, repoId, slot)
      const owned = record ? getMissionOwnedWorktree(this.store, mission, record) : null
      if (owned) {
        candidates.set(owned.worktreeId, owned)
      }
    }
    for (const candidate of findMissionRepoOwnedWorktrees(this.store, mission.id, repoId)) {
      candidates.set(candidate.worktreeId, candidate)
    }
    for (const candidate of candidates.values()) {
      this.slotWorktrees.detachWorktree(mission, repoId, candidate)
    }
  }

  /** Drops a repo's task and preview records; their checkouts are already gone or detached. */
  private pruneLayerRecords(missionId: string, repoId: string): void {
    const mission = this.store.getMission(missionId)
    if (!mission) {
      return
    }
    for (const task of getRepoTaskStack(mission, repoId).toReversed()) {
      this.store.removeMissionTask(missionId, task.id)
    }
    if (getMissionSlotRecord(mission, repoId, 'preview')) {
      this.store.setMissionSlotWorktree(missionId, repoId, 'preview', null, null)
    }
  }

  async teardownSession(mission: Mission): Promise<void> {
    const workspace = this.store.getMissionSessionWorkspace(mission.id)
    if (workspace) {
      await this.runtime.teardownWorkspaceProcesses(folderWorkspaceKey(workspace.id))
    }
  }
}
