import { useCallback, useState } from 'react'
import type { DragEndEvent, DragMoveEvent, DragOverEvent } from '@dnd-kit/core'
import { getHiddenClusterTabIds, type TabGroup } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import { getTabClusterForTab } from '../../store/slices/tabs/tab-cluster-model'
import {
  getTabClusterSortableId,
  isTabClusterDragData,
  type TabDragItemData,
  type TabStripDragItemData
} from './tab-drag-data'
import { resolveTabClusterDropTarget } from './tab-cluster-drop-target'

// Keep tabs anchored and draw the insertion bar on the hovered tab’s before/after edge.
export type HoveredTabInsertion = {
  groupId: string
  visibleTabId: string
  side: 'left' | 'right'
}

export type TabIndicatorEdge = {
  visibleTabId: string
  side: 'left' | 'right'
}

export function resolveTabInsertion(
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  isTabDragData: (value: unknown) => value is TabDragItemData,
  getDragCenter: (event: DragMoveEvent | DragOverEvent | DragEndEvent) => {
    x: number
    y: number
  } | null,
  targetGroup?: TabGroup
): HoveredTabInsertion | null {
  const overData = event.over?.data.current
  const activeData = event.active.data.current
  const activeIsTab = isTabDragData(activeData)
  const overIsTab = isTabDragData(overData)
  if (
    !event.over ||
    (!activeIsTab && !isTabClusterDragData(activeData)) ||
    (!overIsTab && !isTabClusterDragData(overData)) ||
    activeData.worktreeId !== overData.worktreeId
  ) {
    return null
  }
  if (
    (activeIsTab && overIsTab && activeData.unifiedTabId === overData.unifiedTabId) ||
    (isTabClusterDragData(activeData) &&
      isTabClusterDragData(overData) &&
      activeData.groupId === overData.groupId &&
      activeData.clusterId === overData.clusterId)
  ) {
    return null
  }
  const center = getDragCenter(event)
  if (!center) {
    return null
  }
  const midpoint = event.over.rect.left + event.over.rect.width / 2
  const insertion: HoveredTabInsertion = {
    groupId: overData.groupId,
    visibleTabId: overIsTab
      ? overData.visibleTabId
      : getTabClusterSortableId(overData.groupId, overData.clusterId),
    side: center.x < midpoint ? 'left' : 'right'
  }
  return targetGroup
    ? resolveClusterIndicator(insertion, targetGroup, activeData, overData)
    : insertion
}

function resolveClusterIndicator(
  insertion: HoveredTabInsertion,
  targetGroup: TabGroup,
  activeDrag: TabStripDragItemData,
  overData: TabStripDragItemData
): HoveredTabInsertion | null {
  const target = resolveTabClusterDropTarget({
    activeDrag,
    overData,
    targetGroup,
    side: insertion.side
  })
  if (!target) {
    return null
  }
  const cluster = isTabClusterDragData(overData)
    ? targetGroup.tabClusters?.find((item) => item.id === overData.clusterId)
    : getTabClusterForTab(targetGroup.tabClusters, overData.unifiedTabId)
  if (!cluster) {
    return insertion
  }
  if (activeDrag.kind === 'tab' && overData.kind === 'tab') {
    if (
      insertion.side === 'left' &&
      overData.unifiedTabId === cluster.tabIds[0] &&
      target.clusterId !== cluster.id
    ) {
      return { ...insertion, visibleTabId: getTabClusterSortableId(targetGroup.id, cluster.id) }
    }
    return insertion
  }
  const side = isTabClusterDragData(activeDrag) ? insertion.side : 'right'
  if (side === 'left') {
    return { ...insertion, visibleTabId: getTabClusterSortableId(targetGroup.id, cluster.id), side }
  }
  const hidden = getHiddenClusterTabIds(targetGroup)
  const lastVisibleMember = cluster.tabIds.findLast((id) => !hidden.has(id))
  const lastVisibleTab = lastVisibleMember
    ? useAppStore
        .getState()
        .unifiedTabsByWorktree[targetGroup.worktreeId]?.find((tab) => tab.id === lastVisibleMember)
    : null
  const visibleTabId = lastVisibleTab
    ? lastVisibleTab.contentType === 'terminal' ||
      lastVisibleTab.contentType === 'browser' ||
      lastVisibleTab.contentType === 'agent-session'
      ? lastVisibleTab.entityId
      : lastVisibleTab.id
    : (lastVisibleMember ?? getTabClusterSortableId(targetGroup.id, cluster.id))
  return { ...insertion, visibleTabId, side }
}

export function resolveTabIndicatorEdges(
  orderedVisibleTabIds: string[],
  hoveredTabInsertion: HoveredTabInsertion | null
): TabIndicatorEdge[] {
  if (!hoveredTabInsertion || orderedVisibleTabIds.length === 0) {
    return []
  }

  const hoveredIndex = orderedVisibleTabIds.indexOf(hoveredTabInsertion.visibleTabId)
  if (hoveredIndex === -1) {
    return []
  }

  const insertionIndex = hoveredIndex + (hoveredTabInsertion.side === 'right' ? 1 : 0)
  if (insertionIndex < orderedVisibleTabIds.length) {
    return [{ visibleTabId: orderedVisibleTabIds[insertionIndex]!, side: 'left' }]
  }
  return [{ visibleTabId: orderedVisibleTabIds[insertionIndex - 1]!, side: 'right' }]
}

function equal(a: HoveredTabInsertion | null, b: HoveredTabInsertion | null): boolean {
  if (a === b) {
    return true
  }
  return (
    a !== null &&
    b !== null &&
    a.groupId === b.groupId &&
    a.visibleTabId === b.visibleTabId &&
    a.side === b.side
  )
}

export function useHoveredTabInsertion(
  isTabDragData: (value: unknown) => value is TabDragItemData,
  getDragCenter: (event: DragMoveEvent | DragOverEvent) => { x: number; y: number } | null
): {
  hoveredTabInsertion: HoveredTabInsertion | null
  update: (event: DragMoveEvent | DragOverEvent) => void
  clear: () => void
} {
  const [hoveredTabInsertion, setHoveredTabInsertion] = useState<HoveredTabInsertion | null>(null)
  const update = useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const overData = event.over?.data.current
      const targetGroup =
        isTabDragData(overData) || isTabClusterDragData(overData)
          ? useAppStore
              .getState()
              .groupsByWorktree[overData.worktreeId]?.find((group) => group.id === overData.groupId)
          : undefined
      const next = resolveTabInsertion(event, isTabDragData, getDragCenter, targetGroup)
      setHoveredTabInsertion((prev) => (equal(prev, next) ? prev : next))
    },
    [isTabDragData, getDragCenter]
  )
  const clear = useCallback(() => setHoveredTabInsertion(null), [])
  return { hoveredTabInsertion, update, clear }
}
