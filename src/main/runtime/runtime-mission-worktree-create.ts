import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { isMissionSlot } from '../../shared/mission-task-stack'
import type { MissionSlot } from '../../shared/mission-types'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { removeWorktree } from '../git/worktrees/removal/worktree-removal'
import { assertOwnedMissionRoot } from '../missions/mission-root'
import {
  clearMissionWorktreeCreateIntent,
  type MissionRootOwnership,
  type MissionWorktreeCreateIntent
} from '../missions/mission-worktree-create-intent'
import { writeMissionWorktreeOwnershipMarker } from '../missions/mission-worktree-ownership-marker'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { RuntimeStore } from './runtime-store-contract'

export type MissionManagedWorktreeCreate = {
  missionWorktreePath: string | null
  missionRootOwnership: MissionRootOwnership | null
  worktreeInstanceId: string | null
}

export function resolveMissionManagedWorktreeCreate(args: {
  request: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  store: RuntimeStore
}): MissionManagedWorktreeCreate {
  const { request, repo, store } = args
  if (
    request.missionSlot !== undefined &&
    (!request.missionId || !isMissionSlot(request.missionSlot))
  ) {
    throw new Error('Mission slot requires a valid slot and its Mission.')
  }
  if (
    request.missionSlot !== undefined &&
    request.missionSlot !== 'member' &&
    request.worktreePathOverride === undefined
  ) {
    // Why: only an in-root create writes the crash intent that recovers a non-member slot.
    throw new Error('Mission slot worktrees must be created inside the Mission root.')
  }
  if (request.requireExactBranchName) {
    if (!request.branchNameOverride) {
      throw new Error('Exact branch creation requires branchNameOverride.')
    }
    if (repo.connectionId) {
      // Why: the SSH create helper owns its suffix retry loop and cannot yet
      // guarantee an exact branch without risking an orphaned remote worktree.
      throw new Error('Exact branch creation is not supported for SSH-backed repositories.')
    }
    if (isFolderRepo(repo)) {
      throw new Error('Exact branch creation requires a Git repository.')
    }
  }
  if (request.worktreePathOverride === undefined) {
    return {
      missionWorktreePath: null,
      missionRootOwnership: null,
      worktreeInstanceId: request.missionId ? randomUUID() : null
    }
  }
  if (
    !request.missionId ||
    !request.requireExactBranchName ||
    !isAbsolute(request.worktreePathOverride)
  ) {
    throw new Error('Mission worktree path override requires an absolute exact-branch target.')
  }
  const mission = store.getMission?.(request.missionId)
  const resolvedPath = resolve(request.worktreePathOverride)
  const resolvedRoot = mission?.rootPath ? resolve(mission.rootPath) : null
  if (
    !resolvedRoot ||
    resolvedPath !== request.worktreePathOverride ||
    normalizeRuntimePathForComparison(dirname(resolvedPath)) !==
      normalizeRuntimePathForComparison(resolvedRoot)
  ) {
    throw new Error('Mission worktree path must be a direct child of its owned root.')
  }
  if (!mission?.rootBasePath) {
    throw new Error('Mission worktree path requires a persisted root base.')
  }
  // Why: persisted paths are untrusted and the root may have been replaced
  // after session ensure; prove marker ownership immediately before Git writes.
  assertOwnedMissionRoot({
    baseDir: mission.rootBasePath,
    rootPath: resolvedRoot,
    missionId: mission.id
  })
  return {
    missionWorktreePath: resolvedPath,
    missionRootOwnership: {
      baseDir: mission.rootBasePath,
      rootPath: resolvedRoot,
      missionId: mission.id
    },
    worktreeInstanceId: randomUUID()
  }
}

export function getNonMemberMissionSlotStamp(slot: MissionSlot | undefined): {
  missionSlot?: Exclude<MissionSlot, 'member'>
} {
  return slot === undefined || slot === 'member' ? {} : { missionSlot: slot }
}

export async function stampMissionWorktreeAfterCreate(args: {
  request: RuntimeManagedWorktreeCreateArgs
  repo: Repo
  created: GitWorktreeInfo
  checkoutExistingBranch: boolean
  worktreeInstanceId: string
  missionRootOwnership: MissionRootOwnership | null
  missionCreateIntent: MissionWorktreeCreateIntent | null
  localWorktreeGitOptions: { wslDistro?: string }
}): Promise<void> {
  if (!args.request.missionId) {
    return
  }
  const worktreeId = `${args.repo.id}::${args.created.path}`
  try {
    // Why: path and branch can both be reused after an external Git remove;
    // the admin-dir marker proves this exact linked-worktree incarnation.
    writeMissionWorktreeOwnershipMarker({
      repoPath: args.repo.path,
      worktreePath: args.created.path,
      proof: {
        missionId: args.request.missionId,
        repoId: args.repo.id,
        worktreeId,
        worktreeInstanceId: args.worktreeInstanceId,
        ...(args.checkoutExistingBranch ? { preserveBranchOnDelete: true } : {}),
        ...getNonMemberMissionSlotStamp(args.request.missionSlot)
      }
    })
  } catch (error) {
    let rollbackComplete = false
    try {
      await removeWorktree(args.repo.path, args.created.path, true, {
        knownRemovedWorktree: args.created,
        deleteBranch: !args.checkoutExistingBranch,
        forceBranchDelete: !args.checkoutExistingBranch,
        ...args.localWorktreeGitOptions
      })
      rollbackComplete = true
    } catch (cleanupError) {
      console.warn('[missions] failed to roll back unstamped Mission worktree:', cleanupError)
    }
    if (rollbackComplete && args.missionCreateIntent && args.missionRootOwnership) {
      try {
        clearMissionWorktreeCreateIntent({
          root: args.missionRootOwnership,
          intent: args.missionCreateIntent
        })
      } catch (cleanupError) {
        console.warn('[missions] failed to clear rolled-back create intent:', cleanupError)
      }
    }
    throw error
  }
  if (args.missionCreateIntent && args.missionRootOwnership) {
    try {
      clearMissionWorktreeCreateIntent({
        root: args.missionRootOwnership,
        intent: args.missionCreateIntent
      })
    } catch (cleanupError) {
      // The marker is already durable; a later strict scan can clear the
      // matching intent without risking duplicate creation.
      console.warn('[missions] failed to clear completed create intent:', cleanupError)
    }
  }
}
