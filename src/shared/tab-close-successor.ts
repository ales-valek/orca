import { getHiddenClusterTabIds, type TabGroup } from './tab-types'

export function pickNextActiveTab(
  tabOrder: readonly string[],
  recentTabIds: readonly string[] | undefined,
  closingTabId: string
): string | null {
  // Why: legacy duplicate orders use each id's first position for neighbor selection.
  const firstIndices = new Map<string, number>()
  let closingIndex = -1
  let lastSurvivingId: string | null = null
  for (let index = 0; index < tabOrder.length; index += 1) {
    const id = tabOrder[index]
    if (id === closingTabId) {
      if (closingIndex === -1) {
        closingIndex = index
      }
      continue
    }
    if (!firstIndices.has(id)) {
      firstIndices.set(id, index)
    }
    lastSurvivingId = id
  }
  if (recentTabIds) {
    for (let index = recentTabIds.length - 1; index >= 0; index -= 1) {
      const id = recentTabIds[index]
      if (firstIndices.has(id)) {
        return id
      }
    }
  }
  for (const [id, index] of firstIndices) {
    if (index > closingIndex) {
      return id
    }
  }
  return lastSurvivingId
}

export function pickTabCloseSuccessor(
  group: Pick<TabGroup, 'activeTabId' | 'recentTabIds' | 'tabClusters'>,
  tabOrder: readonly string[],
  closingTabId: string
): string | null {
  if (tabOrder.length <= 1) {
    return null
  }
  // Why: automatic close repair must not reveal a collapsed member while a visible survivor remains.
  const hiddenTabIds = group.tabClusters?.some((cluster) => cluster.collapsed)
    ? getHiddenClusterTabIds(group)
    : undefined
  const visibleOrder = hiddenTabIds?.size
    ? tabOrder.filter((tabId) => !hiddenTabIds.has(tabId))
    : tabOrder
  return pickNextActiveTab(
    visibleOrder.some((tabId) => tabId !== closingTabId) ? visibleOrder : tabOrder,
    group.recentTabIds,
    closingTabId
  )
}

/** The tab a group shows after `closingIds` leave it: most recent remaining, else the closed tab's right neighbour, else the last. */
export function pickNextActiveTabAfterClose(
  group: Pick<TabGroup, 'tabOrder' | 'recentTabIds'>,
  closingIds: ReadonlySet<string>,
  remaining: readonly string[],
  remainingIds: ReadonlySet<string>
): string | null {
  for (let index = (group.recentTabIds?.length ?? 0) - 1; index >= 0; index -= 1) {
    const id = group.recentTabIds![index]
    if (remainingIds.has(id)) {
      return id
    }
  }
  const firstIndices = new Map<string, number>()
  group.tabOrder.forEach((id, index) => {
    if (!firstIndices.has(id)) {
      firstIndices.set(id, index)
    }
  })
  const closingIndex = group.tabOrder.findIndex((id) => closingIds.has(id))
  // -1 matches the pre-index `indexOf` miss, so an id outside `group.tabOrder` never wins.
  return (
    remaining.find((id) => (firstIndices.get(id) ?? -1) > closingIndex) ?? remaining.at(-1) ?? null
  )
}
