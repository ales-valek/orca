import { useAppStore } from '../../store'
import type { AppState } from '../../store/types'
import type { TabDragActivationSnapshot } from '../../store/slices/tabs/tabs-slice-contract'
import { previewActiveSurfacePatch } from '../../store/slices/tabs/tabs-drag-preview-actions'

export function captureTabDragActivationSnapshot(worktreeId: string): TabDragActivationSnapshot {
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  return {
    activeGroupId: state.activeGroupIdByWorktree[worktreeId] ?? null,
    activeTabIdByGroup: Object.fromEntries(groups.map((group) => [group.id, group.activeTabId]))
  }
}

export function applyDragPreviewTab({
  worktreeId,
  groupId,
  tabId,
  activeGroupId
}: {
  worktreeId: string
  groupId: string
  tabId: string | null
  activeGroupId: string
}): void {
  useAppStore.setState((state): Partial<AppState> => {
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const targetGroup = groups.find((group) => group.id === groupId)
    const groupUnchanged = targetGroup?.activeTabId === tabId
    const focusUnchanged = (state.activeGroupIdByWorktree[worktreeId] ?? null) === activeGroupId
    const surfacePatch = previewActiveSurfacePatch(state, worktreeId, groupId, tabId)
    if (groupUnchanged && focusUnchanged) {
      return Object.keys(surfacePatch).length > 0 ? surfacePatch : state
    }

    const next: Partial<AppState> = { ...surfacePatch }
    if (!groupUnchanged) {
      next.groupsByWorktree = {
        ...state.groupsByWorktree,
        [worktreeId]: groups.map((group) =>
          group.id === groupId ? { ...group, activeTabId: tabId } : group
        )
      }
    }
    if (!focusUnchanged) {
      next.activeGroupIdByWorktree = {
        ...state.activeGroupIdByWorktree,
        [worktreeId]: activeGroupId
      }
    }
    return next
  })
}

export function restoreTabDragActivationSnapshot(
  worktreeId: string,
  snapshot: TabDragActivationSnapshot
): void {
  useAppStore.setState((state): Partial<AppState> => {
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const groupsUnchanged = groups.every(
      (group) => (snapshot.activeTabIdByGroup[group.id] ?? null) === group.activeTabId
    )
    const focusUnchanged =
      (state.activeGroupIdByWorktree[worktreeId] ?? null) === snapshot.activeGroupId

    const next: Partial<AppState> = {}
    if (!groupsUnchanged) {
      next.groupsByWorktree = {
        ...state.groupsByWorktree,
        [worktreeId]: groups.map((group) => ({
          ...group,
          activeTabId: snapshot.activeTabIdByGroup[group.id] ?? null
        }))
      }
    }
    if (!focusUnchanged) {
      if (snapshot.activeGroupId === null) {
        const nextActiveGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete nextActiveGroupIdByWorktree[worktreeId]
        next.activeGroupIdByWorktree = nextActiveGroupIdByWorktree
      } else {
        next.activeGroupIdByWorktree = {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: snapshot.activeGroupId
        }
      }
    }

    const restoredGroupId = snapshot.activeGroupId
    if (restoredGroupId) {
      const restoredTabId = snapshot.activeTabIdByGroup[restoredGroupId] ?? null
      Object.assign(
        next,
        previewActiveSurfacePatch(state, worktreeId, restoredGroupId, restoredTabId)
      )
    }

    if (Object.keys(next).length === 0) {
      return state
    }

    return next
  })
}

export function restoreSourceGroupActiveTabAfterCrossGroupDrop({
  worktreeId,
  snapshot,
  sourceGroupId,
  movedTabIds
}: {
  worktreeId: string
  snapshot: TabDragActivationSnapshot
  sourceGroupId: string
  movedTabIds: readonly string[]
}): void {
  const preDragActiveTabId = snapshot.activeTabIdByGroup[sourceGroupId] ?? null
  // Why: the move already chooses a source fallback when its active tab leaves with the drag.
  if (preDragActiveTabId && movedTabIds.includes(preDragActiveTabId)) {
    return
  }

  useAppStore.setState((state): Partial<AppState> => {
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const sourceGroup = groups.find((group) => group.id === sourceGroupId)
    if (
      !sourceGroup ||
      sourceGroup.activeTabId === preDragActiveTabId ||
      (preDragActiveTabId !== null && !sourceGroup.tabOrder.includes(preDragActiveTabId))
    ) {
      return state
    }
    return {
      groupsByWorktree: {
        ...state.groupsByWorktree,
        [worktreeId]: groups.map((group) =>
          group.id === sourceGroupId ? { ...group, activeTabId: preDragActiveTabId } : group
        )
      }
    }
  })
}
