import {
  getExecutionHostIdForWorktree,
  runtimeEnvironmentIdOrLocalUnlessTwin
} from '@/lib/workspace/ownership/worktree-runtime-owner'
import type { WorktreeRuntimeOwnerState } from '@/lib/workspace/ownership/worktree-runtime-owner-state'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isWebRuntimeSessionActive } from '../../runtime/web-session-tabs-sync/identity/web-runtime-session-environment'

export type TabClusterSplitBlocker = 'remote-server'

/** Why a whole cluster can't move into a new split here, or null when it can. */
export function getTabClusterSplitBlocker(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string
): TabClusterSplitBlocker | null {
  // The owner a row projects, else the host the focused workspace route names.
  const host = parseExecutionHostId(getExecutionHostIdForWorktree(state, worktreeId))
  const environmentId =
    runtimeEnvironmentIdOrLocalUnlessTwin(state, worktreeId) ??
    (host?.kind === 'runtime' ? host.environmentId : null)
  // Why: the single-tab mirror protocol cannot target the host's newly generated split pane id.
  return isWebRuntimeSessionActive(environmentId) ? 'remote-server' : null
}
