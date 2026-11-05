import { useAppStore } from '@/store'
import { isListedMissionSessionWorkspace } from '../../../../shared/missions'
import {
  getSingleContextDeleteRestriction,
  type SingleContextDeleteRestriction
} from './workspace-actions/context-menu/worktree-context-menu-policy'

/** Why single-workspace Delete is unavailable, reading Mission session ownership from the store. */
export function useSingleContextDeleteRestriction(menu: {
  isMultiContext: boolean
  folderWorkspaceId: string | null
  removesProject: boolean
  worktree: { isMainWorktree: boolean }
}): SingleContextDeleteRestriction {
  const isMissionSessionWorkspace = useAppStore((s) =>
    isListedMissionSessionWorkspace(s.folderWorkspaces, menu.folderWorkspaceId)
  )
  return getSingleContextDeleteRestriction({
    isMultiContext: menu.isMultiContext,
    isMissionSessionWorkspace,
    isMainWorktree: menu.worktree.isMainWorktree,
    removesProject: menu.removesProject
  })
}
