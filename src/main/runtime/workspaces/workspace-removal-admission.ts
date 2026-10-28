import { getRepoExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import type { RemoveWorktreeResult } from '../../../shared/worktree/create-types'
import { preservedBranchCleanupScopeKey } from '../../../shared/preserved-branch-cleanup'
import { finishAcceptedWorktreeRemoval } from '../../worktree-background-removal'
import {
  assertWslMoveWorkspaceWritable,
  isWslMoveSourceHost
} from '../../persistence/moving-wsl-projects/wsl-move-scope-guard'
import { resolveWorktreeRemovalRepoOwner } from '../../worktree-removal-repo-owner'
import {
  getRuntimeWorktreeRemovalOptionsKey,
  type RemoveManagedWorktreeOptions,
  type RuntimeWorktreeRemovalTarget
} from '../runtime-worktree-selection'
import type { RuntimeStore } from '../runtime-store-contract'

type RemovalResult = RemoveWorktreeResult & { warning?: string }

/** Refuses a paused WSL move, then joins a removal that is already running. */
export async function admitManagedWorktreeRemoval(args: {
  store: RuntimeStore
  removalTarget: RuntimeWorktreeRemovalTarget
  cleanupHostId: ExecutionHostId | undefined
  options: RemoveManagedWorktreeOptions
  joinPending: (
    worktreeId: string,
    options: RemoveManagedWorktreeOptions
  ) => Promise<RemovalResult> | null | undefined
  getInFlight: (
    scopeKey: string,
    worktreeId: string,
    optionsKey: string
  ) => Promise<RemovalResult> | null | undefined
  emitLifecycle: (event: { kind: 'removed'; worktreeId: string; path: string }) => void
}): Promise<
  | { joined: RemovalResult }
  | { emitRemoved: () => void; cleanupScopeKey: string; optionsKey: string }
> {
  const fenceOwner = resolveWorktreeRemovalRepoOwner(
    args.store,
    args.removalTarget.repoId,
    args.cleanupHostId
  )
  const fenceHostId =
    fenceOwner.kind === 'resolved' ? getRepoExecutionHostId(fenceOwner.repo) : args.cleanupHostId
  if (isWslMoveSourceHost(fenceHostId)) {
    assertWslMoveWorkspaceWritable(args.store, args.removalTarget.id)
  }
  const pending = args.joinPending(args.removalTarget.id, args.options)
  if (pending) {
    return {
      joined: args.options.waitForBackgroundRemoval ? await pending : { removing: true }
    }
  }
  const emitRemoved = (): void =>
    args.emitLifecycle({
      kind: 'removed',
      worktreeId: args.removalTarget.id,
      path: args.removalTarget.path
    })
  const cleanupScopeKey = preservedBranchCleanupScopeKey({
    worktreeId: args.removalTarget.id,
    hostId: args.cleanupHostId
  })
  const optionsKey = getRuntimeWorktreeRemovalOptionsKey(args.options)
  const inFlightRemoval = args.getInFlight(cleanupScopeKey, args.removalTarget.id, optionsKey)
  if (inFlightRemoval) {
    return {
      joined: args.options.waitForBackgroundRemoval
        ? await finishAcceptedWorktreeRemoval(
            await inFlightRemoval,
            args.removalTarget.id,
            args.cleanupHostId
          )
        : await inFlightRemoval
    }
  }
  return { emitRemoved, cleanupScopeKey, optionsKey }
}
