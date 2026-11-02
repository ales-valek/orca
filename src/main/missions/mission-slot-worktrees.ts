import path from 'node:path'
import { getMissionRootDirName, getMissionWorktreeName } from '../../shared/missions'
import { getMissionSlotBranch } from '../../shared/mission-task-stack'
import type { Mission, MissionMemberResult, MissionSlot } from '../../shared/mission-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { areWorktreePathsEqual } from '../git/worktree-path-comparison'
import type { MissionMemberOwnershipRecovery } from './mission-member-ownership-recovery'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import {
  getMissionOwnedWorktree,
  getMissionRepoNonMemberSlots,
  getMissionSlotRecord,
  writeMissionSlotPointer,
  type MissionOwnedWorktree
} from './mission-worktree-ownership'
import {
  removeMissionWorktreeOwnershipMarker,
  type MissionWorktreeOwnershipProof
} from './mission-worktree-ownership-marker'
import { localMissionWorktreeTarget } from './local-mission-worktree-target'

export type MissionSlotWorktreeOptions = {
  branchName: string
  baseBranch?: string
  directoryName: string
}

type NonMemberSlot = Exclude<MissionSlot, 'member'>

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Root child directory of a repo's member worktree; other slots append `--<suffix>`. */
export function getMissionSlotDirectoryName(repoDisplayName: string, repoId: string): string {
  return `${getMissionRootDirName(repoDisplayName)}-${repoId.slice(0, 8)}`
}

function getOwnershipProof(
  mission: Pick<Mission, 'id'>,
  repoId: string,
  slot: MissionSlot,
  owned: MissionOwnedWorktree
): MissionWorktreeOwnershipProof {
  return {
    missionId: mission.id,
    repoId,
    worktreeId: owned.worktreeId,
    worktreeInstanceId: owned.worktreeInstanceId,
    ...(slot === 'member' ? {} : { missionSlot: slot })
  }
}

/** Creates, removes and detaches the worktree of any Mission slot. */
export class MissionSlotWorktrees {
  constructor(
    private readonly store: Store,
    private readonly runtime: OrcaRuntimeService,
    private readonly ownershipRecovery: MissionMemberOwnershipRecovery
  ) {}

  async create(
    mission: Mission,
    repoId: string,
    slot: MissionSlot,
    opts: MissionSlotWorktreeOptions
  ): Promise<MissionMemberResult> {
    try {
      requireNativeLocalMissionRepos(this.store, [repoId])
      const current = this.store.getMission(mission.id)
      if (!current || !getMissionSlotBranch(current, repoId, slot)) {
        throw new Error('mission_member_not_found')
      }
      // Why: metadata ownership is durable before the slot pointer. Adopt
      // that crash-window worktree instead of creating a second checkout.
      const recovered = await this.ownershipRecovery.recoverLiveOwnedWorktree(current, repoId, slot)
      if (recovered) {
        writeMissionSlotPointer(
          this.store,
          current.id,
          repoId,
          slot,
          recovered.worktreeId,
          recovered.worktreeInstanceId
        )
        return { repoId, ...recovered }
      }
      await this.clearMissingPointer(current, repoId, slot)
      const repo = this.store.getRepo(repoId)
      if (!repo || !current.rootPath) {
        throw new Error('mission_root_not_ready')
      }
      const pathSeed = [
        getMissionWorktreeName(current.branchName),
        current.id.slice(0, 8),
        repoId.slice(0, 8)
      ].join('-')
      const created = await this.runtime.createManagedWorktree({
        repoSelector: `id:${repoId}`,
        // Why: flat workspace layouts share one directory; the path seed must
        // be unique without changing the branch shared across repositories.
        name: slot === 'member' ? pathSeed : `${pathSeed}--${opts.directoryName}`,
        displayName: repo.displayName,
        branchNameOverride: opts.branchName,
        ...(opts.baseBranch ? { baseBranch: opts.baseBranch } : {}),
        requireExactBranchName: true,
        missionId: current.id,
        ...(slot === 'member' ? {} : { missionSlot: slot }),
        // Why: agents launched at the Mission root need canonical in-tree
        // directories for discovery and sandbox writes; sibling symlinks are insufficient.
        worktreePathOverride: path.join(current.rootPath, opts.directoryName),
        activate: false,
        skipInitialTerminal: true,
        runHooks: false,
        setupDecision: 'skip'
      })
      const parsed = splitWorktreeId(created.worktree.id)
      const meta = this.store.getWorktreeMeta(created.worktree.id)
      const actualBranch = created.worktree.branch.replace(/^refs\/heads\//, '')
      if (
        parsed?.repoId !== repoId ||
        actualBranch !== opts.branchName ||
        meta?.missionId !== current.id ||
        (meta.missionSlot ?? 'member') !== slot ||
        !meta.instanceId
      ) {
        throw new Error('mission_member_worktree_ownership_stamp_failed')
      }
      writeMissionSlotPointer(
        this.store,
        current.id,
        repoId,
        slot,
        created.worktree.id,
        meta.instanceId
      )
      return { repoId, worktreeId: created.worktree.id, worktreeInstanceId: meta.instanceId }
    } catch (error) {
      const message = toErrorMessage(error)
      this.store.setMissionSlotError(mission.id, repoId, slot, message)
      return { repoId, worktreeId: null, error: message }
    }
  }

  /** Removes (or only detaches) a non-member slot's worktree and clears its pointer. */
  async remove(
    mission: Mission,
    repoId: string,
    slot: NonMemberSlot,
    deleteWorktree: boolean
  ): Promise<MissionMemberResult> {
    const record = getMissionSlotRecord(mission, repoId, slot)
    try {
      requireNativeLocalMissionRepos(this.store, [repoId])
      const owned = await this.ownershipRecovery.recoverLiveOwnedWorktree(mission, repoId, slot)
      let warning: string | undefined
      if (!owned) {
        await this.clearMissingPointer(mission, repoId, slot)
      } else if (deleteWorktree) {
        if (record?.worktreeId !== owned.worktreeId) {
          // Why: a failed removal must leave the pointer naming the live checkout.
          writeMissionSlotPointer(
            this.store,
            mission.id,
            repoId,
            slot,
            owned.worktreeId,
            owned.worktreeInstanceId
          )
        }
        warning = await this.removeOwned(mission, repoId, slot, owned)
      } else if (isInMissionRoot(mission, owned)) {
        // Why: an unowned child would stay visible and writable from the Mission session.
        throw new Error('mission_member_workspace_delete_required')
      } else {
        this.detachWorktree(mission, repoId, owned)
      }
      writeMissionSlotPointer(this.store, mission.id, repoId, slot, null, null)
      return { repoId, worktreeId: null, ...(warning ? { warning } : {}) }
    } catch (error) {
      const message = toErrorMessage(error)
      this.store.setMissionSlotError(mission.id, repoId, slot, message)
      return { repoId, worktreeId: record?.worktreeId ?? null, error: message }
    }
  }

  /** Removes a verified owned checkout; returns a user-facing warning, if any. */
  async removeOwned(
    mission: Mission,
    repoId: string,
    slot: MissionSlot,
    owned: MissionOwnedWorktree
  ): Promise<string | undefined> {
    // Why: Mission creation has no hook-trust confirmation, so deletion may
    // not execute archive hooks merely because the worktree is Mission-owned.
    const removed = await this.runtime.removeManagedWorktree(`id:${owned.worktreeId}`, {
      force: false,
      runHooks: false,
      expectedOwnership: getOwnershipProof(mission, repoId, slot, owned)
    })
    const warnings = [
      removed.warning,
      removed.preservedBranch
        ? `Preserved local branch ${removed.preservedBranch.branchName}.`
        : undefined
    ].filter((warning): warning is string => Boolean(warning))
    return warnings.length > 0 ? warnings.join(' ') : undefined
  }

  /** Clears Mission ownership of one checkout; the checkout itself stays. */
  detachWorktree(mission: Mission, repoId: string, candidate: MissionOwnedWorktree): void {
    const repo = this.store.getRepo(repoId)
    const parsed = splitWorktreeId(candidate.worktreeId)
    if (repo && parsed) {
      try {
        removeMissionWorktreeOwnershipMarker({
          repoPath: repo.path,
          worktreePath: parsed.worktreePath,
          proof: {
            missionId: mission.id,
            repoId,
            worktreeId: candidate.worktreeId,
            worktreeInstanceId: candidate.worktreeInstanceId
          }
        })
      } catch {
        // The checkout is intentionally preserved; stale or missing markers
        // must not prevent clearing Orca's non-destructive Mission metadata.
      }
    }
    this.store.setWorktreeMeta(localMissionWorktreeTarget(candidate.worktreeId), {
      missionId: undefined
    })
  }

  /** True while a task or preview checkout of the repo still lives inside the Mission root. */
  async hasNonMemberCheckoutInRoot(mission: Mission, repoId: string): Promise<boolean> {
    for (const slot of getMissionRepoNonMemberSlots(mission, repoId)) {
      const owned = await this.ownershipRecovery.recoverLiveOwnedWorktree(mission, repoId, slot)
      if (owned && isInMissionRoot(mission, owned)) {
        return true
      }
    }
    return false
  }

  private async clearMissingPointer(
    mission: Mission,
    repoId: string,
    slot: MissionSlot
  ): Promise<void> {
    const record = getMissionSlotRecord(mission, repoId, slot)
    if (
      record &&
      (record.worktreeId || record.worktreeInstanceId) &&
      !getMissionOwnedWorktree(this.store, mission, record)
    ) {
      await this.ownershipRecovery.clearStrictlyMissingSlotPointer(mission, slot, record)
    }
  }
}

export function isInMissionRoot(mission: Mission, owned: MissionOwnedWorktree): boolean {
  const parsed = splitWorktreeId(owned.worktreeId)
  return Boolean(
    parsed &&
    mission.rootPath &&
    areWorktreePathsEqual(path.dirname(parsed.worktreePath), mission.rootPath)
  )
}
