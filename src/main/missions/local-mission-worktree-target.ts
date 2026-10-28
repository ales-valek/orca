import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  hostWorktreeTarget,
  type HostWorktreeTarget
} from '../../shared/worktree/host-qualified-identity'

/** Mission members are local worktrees. */
export function localMissionWorktreeTarget(id: string): HostWorktreeTarget {
  return hostWorktreeTarget({ id, hostId: LOCAL_EXECUTION_HOST_ID })
}
