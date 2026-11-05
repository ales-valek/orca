import type { Repo } from '../../../shared/repo-types'
import { assertWslMoveRepoWritable } from '../../persistence/moving-wsl-projects/wsl-move-scope-guard'
import type { RuntimeManagedWorktreeCreateArgs } from './creation/runtime-managed-worktree-create-types'
import { resolveMissionManagedWorktreeCreate } from '../runtime-mission-worktree-create'
import type { RuntimeStore } from '../runtime-store-contract'

/** Refuses a create into a paused WSL move or a Mission repo its create path cannot serve. */
export function assertManagedWorktreeCreateAllowed(
  store: RuntimeStore,
  repo: Repo,
  request: RuntimeManagedWorktreeCreateArgs
): void {
  // Reject SSH and folder repos before their create helpers can suffix a Mission branch.
  resolveMissionManagedWorktreeCreate({ request, repo, store })
  assertWslMoveRepoWritable(store, repo)
}
