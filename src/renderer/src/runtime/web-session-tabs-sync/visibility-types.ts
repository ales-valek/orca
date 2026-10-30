import { isPseudoWorkspaceId } from '../../../../shared/floating-workspace-worktree'

/** The floating terminal is local-only and never belongs to a host mirror. */
export function isHostMirroredWorktree(worktreeId: string): boolean {
  return !isPseudoWorkspaceId(worktreeId)
}
