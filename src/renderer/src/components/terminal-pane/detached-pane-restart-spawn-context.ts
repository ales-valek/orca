import type { AppState } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { selectFolderWorkspaces } from '@/store/workspace-record-selectors'
import { getFolderWorkspaceOwnerEnv } from '../../../../shared/missions'
import { getMissionBriefPath } from '../../../../shared/mission-source'

export function getWorkspacePath(state: AppState, worktreeId: string): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  return parsed?.type === 'folder'
    ? (selectFolderWorkspaces(state).find((workspace) => workspace.id === parsed.folderWorkspaceId)
        ?.folderPath ?? null)
    : (getWorktreeMapFromState(state).get(worktreeId)?.path ?? null)
}

export function buildPaneIdentityEnv(
  state: AppState,
  worktreeId: string,
  tabId: string,
  leafId: string
): Record<string, string> {
  const parsed = parseWorkspaceKey(worktreeId)
  const folderWorkspace =
    parsed?.type === 'folder'
      ? selectFolderWorkspaces(state).find((workspace) => workspace.id === parsed.folderWorkspaceId)
      : null
  const mission = folderWorkspace
    ? state.missions.find((entry) => entry.id === folderWorkspace.missionId)
    : undefined
  return {
    ORCA_WORKSPACE_ID: worktreeId,
    ...(folderWorkspace
      ? {
          ...getFolderWorkspaceOwnerEnv({
            ...folderWorkspace,
            missionRootPath: mission?.rootPath,
            missionBriefPath: mission ? getMissionBriefPath(mission) : null
          }),
          ORCA_WORKSPACE_ROOT: folderWorkspace.folderPath
        }
      : {}),
    ORCA_PANE_KEY: makePaneKey(tabId, leafId),
    ORCA_TAB_ID: tabId,
    ORCA_WORKTREE_ID: worktreeId
  }
}
