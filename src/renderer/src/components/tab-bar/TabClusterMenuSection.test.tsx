// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { AppState } from '@/store/types'
import {
  createTestStore,
  makeUnifiedTab,
  seedStore,
  type TestStore
} from '@/store/slices/store-test-helpers'
import type { TabCluster, TabGroup } from '../../../../shared/tab-types'
import { TabClusterMenuSection } from './TabClusterMenuSection'
import { getTabClusterMenuTargets } from './tab-strip-selection'

let store: TestStore

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: AppState) => unknown) => store(selector), {
    getState: () => store.getState()
  })
}))

const CLUSTER: TabCluster = {
  id: 'existing',
  name: '',
  color: 'green',
  collapsed: false,
  tabIds: ['b', 'c']
}
const PANE: TabGroup = {
  id: 'pane',
  worktreeId: 'wt',
  activeTabId: 'a',
  tabOrder: ['a', 'b', 'c'],
  tabClusters: [CLUSTER]
}

beforeEach(() => {
  store = createTestStore()
  seedStore(store, {
    groupsByWorktree: { wt: [PANE] },
    unifiedTabsByWorktree: {
      wt: PANE.tabOrder.map((id) =>
        makeUnifiedTab({
          id,
          groupId: 'pane',
          worktreeId: 'wt',
          contentType: 'editor',
          isPinned: id === 'a'
        })
      )
    }
  })
})
afterEach(cleanup)

describe('cluster grouping menu targets', () => {
  it('takes a highlighted right-click target as the whole selection in pane order', () => {
    expect(
      getTabClusterMenuTargets({
        tabId: 'b',
        tabOrder: PANE.tabOrder,
        selection: { tabIds: ['c', 'b'], anchorTabId: 'c' },
        pinnedTabIds: new Set(),
        clusters: [CLUSTER]
      })
    ).toEqual({ groupableTabIds: ['b', 'c'], hasClusterMembers: true })
  })

  it('takes only the right-clicked tab when it is outside the highlighted selection', () => {
    expect(
      getTabClusterMenuTargets({
        tabId: 'a',
        tabOrder: PANE.tabOrder,
        selection: { tabIds: ['b', 'c'], anchorTabId: 'b' },
        pinnedTabIds: new Set(),
        clusters: [CLUSTER]
      })
    ).toEqual({ groupableTabIds: ['a'], hasClusterMembers: false })
  })

  it('skips pinned tabs in a multi-selection', () => {
    expect(
      getTabClusterMenuTargets({
        tabId: 'b',
        tabOrder: PANE.tabOrder,
        selection: { tabIds: ['a', 'b', 'c'], anchorTabId: 'a' },
        pinnedTabIds: new Set(['a', 'b']),
        clusters: [CLUSTER]
      })
    ).toEqual({ groupableTabIds: ['c'], hasClusterMembers: true })
  })

  it('keeps a pinned-only target out of groups through the rendered menu', () => {
    render(
      <ContextMenu open>
        <ContextMenuTrigger asChild>
          <button>Tab menu</button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <TabClusterMenuSection
            worktreeId="wt"
            groupId="pane"
            tabId="a"
            isPinned
            onQueueNewCluster={(create) => create()}
          />
        </ContextMenuContent>
      </ContextMenu>
    )
    const create = screen.getByRole('menuitem', { name: 'Add Tab to New Group' })
    expect(create.getAttribute('aria-disabled')).toBe('true')
    expect(
      screen.getByRole('menuitem', { name: 'Add to Group' }).getAttribute('aria-disabled')
    ).toBe('true')
    fireEvent.click(create)
    expect(store.getState().groupsByWorktree.wt[0].tabOrder).toEqual(PANE.tabOrder)
    expect(store.getState().groupsByWorktree.wt[0].tabClusters).toEqual([CLUSTER])
  })
})
