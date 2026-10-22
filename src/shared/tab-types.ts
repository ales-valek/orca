import type { AiVaultSessionTitle } from './ai-vault/contracts/ai-vault-session-title'
import type { AgentType } from './agent-status/contracts/agent-status-types'
import type { ExecutionHostId } from './execution-host'

export type TabGroupSplitDirection = 'horizontal' | 'vertical'

export type TabGroupLayoutNode =
  | { type: 'leaf'; groupId: string }
  | {
      type: 'split'
      direction: TabGroupSplitDirection
      first: TabGroupLayoutNode
      second: TabGroupLayoutNode
      /** Flex ratio of the first child (0–1). Defaults to 0.5 if absent. */
      ratio?: number
    }

export type TabContentType =
  | 'terminal'
  | 'editor'
  | 'diff'
  | 'conflict-review'
  | 'check-details'
  | 'git-graph'
  | 'agent-session'
  | 'browser'
  | 'simulator'

export type WorkspaceVisibleTabType =
  | 'terminal'
  | 'editor'
  | 'agent-session'
  | 'browser'
  | 'simulator'
export type CtrlTabOrderMode = 'mru' | 'sequential'

// Many content kinds collapse to editor; resolve a concrete tab and project forward instead of trying to invert equality.
export function toVisibleTabType(contentType: TabContentType): WorkspaceVisibleTabType {
  if (
    contentType === 'agent-session' ||
    contentType === 'browser' ||
    contentType === 'terminal' ||
    contentType === 'simulator'
  ) {
    return contentType
  }
  return 'editor'
}

export type Tab = {
  id: string // UUID for terminals, filePath for editors (preserves current convention)
  entityId: string // ID of the backing content (terminal tab ID, file path, browser workspace ID)
  groupId: string
  worktreeId: string
  /** Owning execution host when the same worktree id is visible from multiple hosts. */
  executionHostId?: ExecutionHostId
  contentType: TabContentType
  label: string // display title (auto-derived from PTY or filename)
  generatedLabel?: string | null
  /** Stable AI Vault conversation name, bound to its provider session identity. */
  aiVaultTitle?: AiVaultSessionTitle | null
  quickCommandLabel?: string | null
  customLabel: string | null
  color: string | null
  sortOrder: number
  createdAt: number
  isPreview?: boolean // preview tabs get replaced by next single-click open
  isPinned?: boolean // pinned tabs survive "close others"
  /** Provider backing a structured agent-session tab. */
  agentSessionAgent?: AgentType
  /** Chat overlays retain the mounted terminal; missing/legacy mode uses raw xterm. */
  viewMode?: 'terminal' | 'chat'
  /** Timestamp when the tab was last focused / activated by the user. */
  lastFocusedAt?: number
}

// ─── Tab Cluster ────────────────────────────────────────────────────
// Why: Chrome-style named group inside ONE pane's strip; "TabGroup" already means a split pane.
export const TAB_CLUSTER_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
] as const
export type TabClusterColor = (typeof TAB_CLUSTER_COLORS)[number]

export type TabCluster = {
  id: string
  /** Empty string renders a color-only chip. */
  name: string
  color: TabClusterColor
  collapsed: boolean
  /** Member unified tab ids: unpinned, present in the pane, contiguous and in pane tabOrder order. */
  tabIds: string[]
  /** While collapsed: the member that was active when the group collapsed, kept visible after you leave it. */
  shownTabId?: string
}

export type TabGroup = {
  id: string
  worktreeId: string
  activeTabId: string | null
  tabOrder: string[] // canonical visual order of tab IDs
  /** Per-group MRU, newest last, restores the previous tab on close instead of a visual neighbor.
   * Legacy sessions omit it; hydration seeds from activeTabId so split groups keep independent histories. */
  recentTabIds?: string[]
  /** Named, collapsible tab clusters within this pane's strip. Absent when the pane has none. */
  tabClusters?: TabCluster[]
}

/** Clusters whose members are still in `tabOrder`, dropping a cluster that lost all of them. */
export function tabClustersWithinOrder(
  clusters: readonly TabCluster[] | undefined,
  tabOrder: readonly string[]
): TabCluster[] | undefined {
  if (!clusters?.length) {
    return undefined
  }
  const live = new Set(tabOrder)
  const kept = clusters
    .map((cluster) => ({ ...cluster, tabIds: cluster.tabIds.filter((id) => live.has(id)) }))
    .filter((cluster) => cluster.tabIds.length > 0)
  return kept.length > 0 ? kept : undefined
}

export function getHiddenClusterTabIds(
  group: Pick<TabGroup, 'tabClusters' | 'activeTabId'>
): ReadonlySet<string> {
  const hidden = new Set<string>()
  for (const cluster of group.tabClusters ?? []) {
    if (!cluster.collapsed) {
      continue
    }
    for (const id of cluster.tabIds) {
      if (id !== group.activeTabId && id !== cluster.shownTabId) {
        hidden.add(id)
      }
    }
  }
  return hidden
}
