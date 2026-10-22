import { recordLayoutApply } from '@/runtime/layout-apply-send'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { tabOrderAnchor } from '../../../../shared/workspace-layout/tab-order'
import type { AppState } from '../types'
import { getTabClusterInsertionIndex } from './tabs/tab-cluster-model'

export type RecentlyClosedTabPosition = {
  tabBarIndex?: number
  groupId?: string
  groupIndex?: number
  clusterId?: string
}

/** Share worktree position index across bulk closes; per-tab order/group rescans make close-all cubic. */
export type RecentlyClosedTabPositionIndex = {
  positionFor: (entityId: string) => RecentlyClosedTabPosition | undefined
}

export function createRecentlyClosedTabPositionIndex(
  state: Pick<AppState, 'tabBarOrderByWorktree' | 'groupsByWorktree' | 'unifiedTabsByWorktree'>,
  worktreeId: string
): RecentlyClosedTabPositionIndex {
  const tabBarOrder = state.tabBarOrderByWorktree?.[worktreeId]
  const unifiedTabs = state.unifiedTabsByWorktree?.[worktreeId] ?? []
  const groups = state.groupsByWorktree?.[worktreeId] ?? []

  // First occurrence wins everywhere, matching the `indexOf`/`find` scans this replaces.
  const tabBarIndexByEntityId = new Map<string, number>()
  const tabByEntityId = new Map<string, (typeof unifiedTabs)[number]>()
  const tabById = new Map<string, (typeof unifiedTabs)[number]>()
  for (const tab of unifiedTabs) {
    if (!tabByEntityId.has(tab.entityId)) {
      tabByEntityId.set(tab.entityId, tab)
    }
    if (!tabById.has(tab.id)) {
      tabById.set(tab.id, tab)
    }
  }
  const tabBarEntityIdsByGroupId = new Map<string, (string | undefined)[]>()
  tabBarOrder?.forEach((entityId, index) => {
    if (!tabBarIndexByEntityId.has(entityId)) {
      tabBarIndexByEntityId.set(entityId, index)
    }
    const tab = tabByEntityId.get(entityId)
    if (!tab?.groupId) {
      return
    }
    const bucket = tabBarEntityIdsByGroupId.get(tab.groupId)
    if (bucket) {
      bucket.push(tab.entityId)
    } else {
      tabBarEntityIdsByGroupId.set(tab.groupId, [tab.entityId])
    }
  })

  const groupById = new Map<string, (typeof groups)[number]>()
  const tabOrderIndexByGroupId = new Map<string, Map<string, number>>()
  const groupOrderMatchesTabBarByGroupId = new Map<string, boolean>()
  const clusterIdByTabIdByGroupId = new Map<string, Map<string, string>>()
  for (const group of groups) {
    if (groupById.has(group.id)) {
      continue
    }
    groupById.set(group.id, group)
    const indexByTabId = new Map<string, number>()
    const groupTabEntityIds = group.tabOrder.map((tabId, index) => {
      if (!indexByTabId.has(tabId)) {
        indexByTabId.set(tabId, index)
      }
      return tabById.get(tabId)?.entityId
    })
    tabOrderIndexByGroupId.set(group.id, indexByTabId)
    const clusterIdByTabId = new Map<string, string>()
    for (const cluster of group.tabClusters ?? []) {
      for (const tabId of cluster.tabIds) {
        if (!clusterIdByTabId.has(tabId)) {
          clusterIdByTabId.set(tabId, cluster.id)
        }
      }
    }
    clusterIdByTabIdByGroupId.set(group.id, clusterIdByTabId)
    const tabBarGroupEntityIds = tabBarEntityIdsByGroupId.get(group.id) ?? []
    groupOrderMatchesTabBarByGroupId.set(
      group.id,
      groupTabEntityIds.length === tabBarGroupEntityIds.length &&
        groupTabEntityIds.every((entityId, index) => entityId === tabBarGroupEntityIds[index])
    )
  }

  return {
    positionFor: (entityId) => {
      const tabBarIndex = tabBarOrder ? (tabBarIndexByEntityId.get(entityId) ?? -1) : -1
      const unifiedTab = tabByEntityId.get(entityId)
      const group = unifiedTab ? groupById.get(unifiedTab.groupId) : undefined
      const groupIndex =
        group && unifiedTab ? (tabOrderIndexByGroupId.get(group.id)?.get(unifiedTab.id) ?? -1) : -1
      if (tabBarIndex < 0 && (!group || groupIndex < 0)) {
        return undefined
      }
      const groupOrderMatchesTabBar =
        !group || (groupOrderMatchesTabBarByGroupId.get(group.id) ?? true)
      const clusterId =
        group && unifiedTab
          ? clusterIdByTabIdByGroupId.get(group.id)?.get(unifiedTab.id)
          : undefined
      return {
        ...(tabBarIndex >= 0 && groupOrderMatchesTabBar ? { tabBarIndex } : {}),
        ...(group && groupIndex >= 0 ? { groupId: group.id, groupIndex } : {}),
        ...(clusterId ? { clusterId } : {})
      }
    }
  }
}

export function getRecentlyClosedTabPosition(
  state: Pick<AppState, 'tabBarOrderByWorktree' | 'groupsByWorktree' | 'unifiedTabsByWorktree'>,
  worktreeId: string,
  entityId: string
): RecentlyClosedTabPosition | undefined {
  return createRecentlyClosedTabPositionIndex(state, worktreeId).positionFor(entityId)
}

export function insertTabAtRecentlyClosedPosition(
  order: readonly string[],
  tabId: string,
  position?: RecentlyClosedTabPosition
): string[] {
  const nextOrder = order.filter((id) => id !== tabId)
  const index = position?.tabBarIndex
  if (index === undefined) {
    return [...nextOrder, tabId]
  }
  nextOrder.splice(Math.min(Math.max(index, 0), nextOrder.length), 0, tabId)
  return nextOrder
}

type RestoreState = Pick<
  AppState,
  | 'tabBarOrderByWorktree'
  | 'groupsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'setTabBarOrder'
  | 'reorderUnifiedTabs'
> &
  Parameters<typeof recordLayoutApply>[0]

export function restoreRecentlyClosedTabPosition(
  getState: () => RestoreState,
  worktreeId: string,
  entityId: string,
  position?: RecentlyClosedTabPosition
): void {
  if (!position) {
    return
  }
  restoreHere(getState, worktreeId, entityId, position)
  // Switch point: main moves the reopened tab to where the window shows it, wherever that came from.
  if (ORCA_LAYOUT_OWNER_IS_MAIN) {
    recordReopenedTabPosition(getState(), worktreeId, entityId, position.groupId)
  }
}

function restoreHere(
  getState: () => RestoreState,
  worktreeId: string,
  entityId: string,
  position: RecentlyClosedTabPosition
): void {
  const state = getState()
  const order = state.tabBarOrderByWorktree?.[worktreeId]
  if (order && typeof state.setTabBarOrder === 'function') {
    state.setTabBarOrder(worktreeId, insertTabAtRecentlyClosedPosition(order, entityId, position))
  }

  if (position?.groupIndex === undefined) {
    return
  }
  const unifiedTab = (getState().unifiedTabsByWorktree?.[worktreeId] ?? []).find(
    (candidate) =>
      candidate.entityId === entityId &&
      (position.groupId === undefined || candidate.groupId === position.groupId)
  )
  if (!unifiedTab) {
    return
  }
  const group = (getState().groupsByWorktree?.[worktreeId] ?? []).find(
    (candidate) => candidate.id === unifiedTab.groupId
  )
  if (!group) {
    return
  }
  const remainingOrder = group.tabOrder.filter((tabId) => tabId !== unifiedTab.id)
  const cluster = position.clusterId
    ? group.tabClusters?.find((candidate) => candidate.id === position.clusterId)
    : undefined
  if (cluster) {
    const start = remainingOrder.indexOf(cluster.tabIds[0])
    const end = remainingOrder.indexOf(cluster.tabIds.at(-1) ?? '') + 1
    // A moved cluster still owns the reopened tab even when its old index is elsewhere.
    const index = Math.max(start, Math.min(position.groupIndex, end))
    getState().moveTabsInStrip(group.id, [unifiedTab.id], {
      index,
      clusterId: cluster.id
    })
    return
  }
  if (typeof getState().reorderUnifiedTabs === 'function') {
    const index = getTabClusterInsertionIndex(
      remainingOrder,
      group.tabClusters,
      position.groupIndex
    )
    remainingOrder.splice(index, 0, unifiedTab.id)
    getState().reorderUnifiedTabs(group.id, remainingOrder, {
      recordInteraction: false,
      // Why: restoreRecentlyClosedTabPosition records the reopened tab's place as one move.
      ...(ORCA_LAYOUT_OWNER_IS_MAIN ? { layoutOwnerHandled: true } : {})
    })
  }
}

function recordReopenedTabPosition(
  state: RestoreState,
  worktreeId: string,
  entityId: string,
  groupId: string | undefined
): void {
  const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (candidate) =>
      candidate.entityId === entityId && (groupId === undefined || candidate.groupId === groupId)
  )
  const group = tab
    ? (state.groupsByWorktree[worktreeId] ?? []).find((candidate) => candidate.id === tab.groupId)
    : undefined
  const index = tab && group ? group.tabOrder.indexOf(tab.id) : -1
  if (tab && group && index !== -1) {
    recordLayoutApply(state, worktreeId, {
      type: 'moveTab',
      tabId: tab.id,
      toGroupId: group.id,
      index,
      afterTabId: tabOrderAnchor(group.tabOrder, index)
    })
  }
}
