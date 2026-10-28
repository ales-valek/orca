import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner-state'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isWebRuntimeSessionActive } from '../../runtime/web-runtime-session-environment'

export type TabClusterSplitBlocker = 'remote-server'

/** Why a whole cluster can't move into a new split here, or null when it can. */
export function getTabClusterSplitBlocker(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string
): TabClusterSplitBlocker | null {
  const host = parseExecutionHostId(getExecutionHostIdForWorktree(state, worktreeId))
  // Why: the single-tab mirror protocol cannot target the host's newly generated split pane id.
  return host?.kind === 'runtime' && isWebRuntimeSessionActive(host.environmentId)
    ? 'remote-server'
    : null
}
