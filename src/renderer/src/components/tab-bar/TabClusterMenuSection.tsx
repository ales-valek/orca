import { Folder, FolderInput, FolderMinus, FolderPlus } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { Tab } from '../../../../shared/tab-types'
import { TAB_CLUSTER_COLOR_CLASSES } from './tab-cluster-colors'
import { getTabClusterMenuTargets } from './tab-strip-selection'

const EMPTY_TABS: readonly Tab[] = []

export function TabClusterMenuSection({
  worktreeId,
  groupId,
  tabId,
  isPinned,
  onQueueNewCluster
}: {
  worktreeId: string
  groupId: string
  tabId: string
  isPinned: boolean
  onQueueNewCluster: (create: () => void) => void
}): React.JSX.Element | null {
  const group = useAppStore((state) =>
    state.groupsByWorktree[worktreeId]?.find((item) => item.id === groupId)
  )
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_TABS)
  const selection = useAppStore((state) => state.tabSelectionByGroupId[groupId])
  const createCluster = useAppStore((state) => state.createTabCluster)
  const addToCluster = useAppStore((state) => state.addTabsToCluster)
  const removeFromCluster = useAppStore((state) => state.removeTabsFromCluster)
  const pinnedTabIds = new Set<string>()
  for (const tab of tabs) {
    if (tab.isPinned) {
      pinnedTabIds.add(tab.id)
    }
  }
  if (isPinned) {
    pinnedTabIds.add(tabId)
  }
  if (!group) {
    return null
  }
  const targets = getTabClusterMenuTargets({
    tabId,
    tabOrder: group.tabOrder,
    selection,
    pinnedTabIds,
    clusters: group.tabClusters
  })
  const disabled = targets.groupableTabIds.length === 0
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={disabled}
        onSelect={() =>
          onQueueNewCluster(() => {
            const clusterId = createCluster(groupId, targets.groupableTabIds)
            if (clusterId) {
              useAppStore.getState().setRenamingTabCluster({ groupId, clusterId })
            }
          })
        }
      >
        <FolderPlus className="size-3.5" />
        {targets.groupableTabIds.length > 1
          ? translate('components.tabCluster.addNewMany', 'Add {{count}} Tabs to New Group', {
              count: targets.groupableTabIds.length
            })
          : translate('components.tabCluster.addNew', 'Add Tab to New Group')}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={disabled || !group.tabClusters?.length}>
          <FolderInput className="size-3.5" />
          {translate('components.tabCluster.addToExisting', 'Add to Group')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-w-[calc(100vw-1rem)] whitespace-nowrap">
          {(group.tabClusters ?? []).map((cluster) => (
            <ContextMenuItem
              key={cluster.id}
              onSelect={() => addToCluster(groupId, cluster.id, targets.groupableTabIds)}
            >
              <Folder className="size-3.5" />
              <span
                aria-hidden
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  TAB_CLUSTER_COLOR_CLASSES[cluster.color]
                )}
              />
              <span className="max-w-48 truncate">
                {cluster.name || translate('components.tabCluster.unnamed', 'Unnamed group')}
              </span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {targets.hasClusterMembers ? (
        <ContextMenuItem
          disabled={disabled}
          onSelect={() => removeFromCluster(groupId, targets.groupableTabIds)}
        >
          <FolderMinus className="size-3.5" />
          {translate('components.tabCluster.remove', 'Remove from Group')}
        </ContextMenuItem>
      ) : null}
    </>
  )
}
