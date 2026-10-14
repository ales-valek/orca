import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import { assertWorktreeIsNotMissionManaged } from '../missions/mission-removal-boundary'
import { assertMissionWorktreeOwnershipMarker } from '../missions/mission-worktree-ownership-marker'
import type { MissionWorktreeOwnershipProof } from '../missions/mission-worktree-ownership-marker'
import type { RuntimeStore } from './runtime-store-contract'
import type { RuntimeWorktreeRemovalTarget } from './runtime-worktree-selection'

export async function guardGenericMissionWorktreeRemoval(args: {
  store: RuntimeStore
  removalTarget: RuntimeWorktreeRemovalTarget
  repo: Repo | undefined
  stopSessionPtys: (workspaceId: string) => Promise<void>
}): Promise<void> {
  assertWorktreeIsNotMissionManaged(
    args.store,
    args.removalTarget.id,
    args.repo && !args.repo.connectionId && !isFolderRepo(args.repo)
      ? { repoPath: args.repo.path, worktreePath: args.removalTarget.path }
      : undefined
  )
  await teardownOwningMissionSession(
    args.store,
    args.store.getWorktreeMeta(args.removalTarget.id)?.missionId,
    args.stopSessionPtys
  )
}

export function assertScopedMissionWorktreeOwnership(args: {
  repo: Repo
  registeredPath: string | undefined
  removedMeta: { missionId?: string; instanceId?: string } | undefined
  expectedOwnership: MissionWorktreeOwnershipProof
  removalTarget: RuntimeWorktreeRemovalTarget
}): void {
  if (
    args.expectedOwnership.repoId !== args.removalTarget.repoId ||
    args.expectedOwnership.worktreeId !== args.removalTarget.id ||
    !args.registeredPath ||
    args.removedMeta?.missionId !== args.expectedOwnership.missionId ||
    args.removedMeta.instanceId !== args.expectedOwnership.worktreeInstanceId
  ) {
    throw new Error('mission_member_worktree_ownership_unverified')
  }
  assertMissionWorktreeOwnershipMarker({
    repoPath: args.repo.path,
    worktreePath: args.registeredPath,
    proof: args.expectedOwnership
  })
}

export async function teardownOwningMissionSession(
  store: RuntimeStore,
  missionId: string | undefined,
  stopSessionPtys: (workspaceId: string) => Promise<void>
): Promise<void> {
  if (!missionId) {
    return
  }
  const workspace = store.getMissionSessionWorkspace?.(missionId)
  if (workspace) {
    // Why: a Mission terminal can hold a cwd beneath a member link even
    // when deletion entered through a generic worktree surface or RPC.
    await stopSessionPtys(folderWorkspaceKey(workspace.id))
  }
}

type RemovedWorktreeMeta = { missionId?: string; instanceId?: string } | undefined

/** The Mission checks a managed worktree removal runs, in order; keeps them out of the removal flow. */
export function missionRemovalGuard(
  stopPtys: (workspaceId: string) => Promise<unknown>,
  store: RuntimeStore,
  removalTarget: RuntimeWorktreeRemovalTarget,
  expectedOwnership: MissionWorktreeOwnershipProof | undefined
) {
  const stopSessionPtys = async (workspaceId: string): Promise<void> => {
    await stopPtys(workspaceId)
  }
  return {
    /** Before any Git work: refuse unverifiable scoped removals, guard generic ones. */
    async beforeRemoval(repo: Repo | undefined): Promise<void> {
      if (!expectedOwnership) {
        await guardGenericMissionWorktreeRemoval({ store, removalTarget, repo, stopSessionPtys })
        return
      }
      if (!repo || repo.connectionId || isFolderRepo(repo)) {
        throw new Error('mission_member_worktree_ownership_unverified')
      }
    },
    /** After the registered checkout is known: prove ownership and stop the Mission session. */
    async afterRegistrationLookup(
      repo: Repo | undefined,
      registeredPath: string | undefined,
      removedMeta: RemovedWorktreeMeta
    ): Promise<void> {
      if (!expectedOwnership || !repo) {
        return
      }
      assertScopedMissionWorktreeOwnership({
        repo,
        registeredPath,
        removedMeta,
        expectedOwnership,
        removalTarget
      })
      await teardownOwningMissionSession(store, expectedOwnership.missionId, stopSessionPtys)
    },
    /** Re-proves ownership at Git's last boundary; undefined for non-Mission removals. */
    ownershipAssertion(
      repo: Repo,
      registeredPath: string,
      removedMeta: RemovedWorktreeMeta
    ): (() => void) | undefined {
      return expectedOwnership
        ? () =>
            assertScopedMissionWorktreeOwnership({
              repo,
              registeredPath,
              removedMeta,
              expectedOwnership,
              removalTarget
            })
        : undefined
    }
  }
}
