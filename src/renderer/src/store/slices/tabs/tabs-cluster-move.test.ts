import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TabCluster } from '../../../../../shared/tab-types'
import { createTestStore, seedStore, type TestStore } from '@/store/testing/app-store-test-fixture'
import { makeTabGroup, makeUnifiedTab } from '@/store/slices/tabs/tab-group.test-fixture'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
createTabsSliceMockApi()
const WT = 'repo1::/tmp/feature'

function cluster(id: string, tabIds: string[], overrides: Partial<TabCluster> = {}): TabCluster {
  return { id, name: '', color: 'blue', collapsed: false, tabIds, ...overrides }
}

describe('moving and merging tab clusters', () => {
  let store: TestStore
  beforeEach(() => {
    store = createTestStore()
  })

  function seedPanes(
    sourceIds: string[],
    destinationIds: string[],
    sourceClusters: TabCluster[],
    destinationClusters?: TabCluster[]
  ): void {
    seedStore(store, {
      activeWorktreeId: WT,
      activeGroupIdByWorktree: { [WT]: 'source' },
      unifiedTabsByWorktree: {
        [WT]: [
          ...sourceIds.map((id, sortOrder) =>
            makeUnifiedTab({
              id,
              worktreeId: WT,
              groupId: 'source',
              sortOrder,
              contentType: 'editor'
            })
          ),
          ...destinationIds.map((id, sortOrder) =>
            makeUnifiedTab({
              id,
              worktreeId: WT,
              groupId: 'destination',
              sortOrder,
              contentType: 'editor'
            })
          )
        ]
      },
      groupsByWorktree: {
        [WT]: [
          makeTabGroup({
            id: 'source',
            worktreeId: WT,
            tabOrder: sourceIds,
            activeTabId: sourceIds[1] ?? sourceIds[0] ?? null,
            recentTabIds: sourceIds.toReversed(),
            tabClusters: sourceClusters
          }),
          makeTabGroup({
            id: 'destination',
            worktreeId: WT,
            tabOrder: destinationIds,
            activeTabId: destinationIds[0] ?? null,
            ...(destinationClusters ? { tabClusters: destinationClusters } : {})
          })
        ]
      },
      layoutByWorktree: {
        [WT]: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', groupId: 'source' },
          second: { type: 'leaf', groupId: 'destination' }
        }
      }
    })
  }

  it('moves every hidden member and the cluster record to another pane in one consistent result', () => {
    seedPanes(
      ['a', 'b', 'stay'],
      ['x', 'y'],
      [cluster('c', ['a', 'b'], { collapsed: true, name: 'Work', shownTabId: 'a' })]
    )
    const snapshots: string[][] = []
    const unsubscribe = store.subscribe((state) => {
      snapshots.push(
        state.groupsByWorktree[WT].flatMap((pane) =>
          (pane.tabClusters ?? []).flatMap((item) => item.tabIds)
        )
      )
    })
    expect(
      store.getState().moveTabCluster('source', 'c', { groupId: 'destination', index: 1 })
    ).toBe(true)
    unsubscribe()
    const state = store.getState()
    const source = state.groupsByWorktree[WT].find((pane) => pane.id === 'source')!
    const destination = state.groupsByWorktree[WT].find((pane) => pane.id === 'destination')!
    expect(source.tabOrder).toEqual(['stay'])
    expect(Object.hasOwn(source, 'tabClusters')).toBe(false)
    expect(source.activeTabId).toBe('stay')
    expect(destination.tabOrder).toEqual(['x', 'a', 'b', 'y'])
    expect(destination.tabClusters).toEqual([
      cluster('c', ['a', 'b'], { collapsed: true, name: 'Work', shownTabId: 'a' })
    ])
    expect(destination.activeTabId).toBe('b')
    expect(state.activeGroupIdByWorktree[WT]).toBe('destination')
    expect(state.activeFileId).toBe('b')
    expect(
      state.unifiedTabsByWorktree[WT].map((tab) => [tab.id, tab.groupId, tab.sortOrder])
    ).toEqual([
      ['a', 'destination', 1],
      ['b', 'destination', 2],
      ['stay', 'source', 0],
      ['x', 'destination', 0],
      ['y', 'destination', 3]
    ])
    expect(snapshots.every((members) => members.join(',') === 'a,b')).toBe(true)
  })

  it('moves a whole cluster to a new edge split and preserves its collapsed presentation', () => {
    seedPanes(
      ['a', 'b', 'stay'],
      ['x'],
      [cluster('c', ['a', 'b'], { collapsed: true, shownTabId: 'a' })]
    )
    expect(
      store.getState().moveTabCluster('source', 'c', { groupId: 'source', splitDirection: 'down' })
    ).toBe(true)
    const state = store.getState()
    const splitPane = state.groupsByWorktree[WT].find(
      (pane) => pane.id !== 'source' && pane.id !== 'destination'
    )!
    expect(splitPane.tabOrder).toEqual(['a', 'b'])
    expect(splitPane.tabClusters).toEqual([
      cluster('c', ['a', 'b'], { collapsed: true, shownTabId: 'a' })
    ])
    expect(splitPane.activeTabId).toBe('b')
    expect(state.groupsByWorktree[WT][0].tabOrder).toEqual(['stay'])
    expect(state.activeGroupIdByWorktree[WT]).toBe(splitPane.id)
    expect(state.activeFileId).toBe('b')
    expect(state.layoutByWorktree[WT]).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', groupId: 'source' },
        second: { type: 'leaf', groupId: splitPane.id }
      },
      second: { type: 'leaf', groupId: 'destination' }
    })
  })

  it('collapses an emptied source pane and prunes its selection when carrying its last cluster', () => {
    seedPanes(['a', 'b'], ['x'], [cluster('c', ['a', 'b'])])
    store.getState().setTabSelection('source', { tabIds: ['a', 'b'], anchorTabId: 'a' })
    expect(store.getState().moveTabCluster('source', 'c', { groupId: 'destination' })).toBe(true)
    const state = store.getState()
    expect(state.groupsByWorktree[WT].map((pane) => pane.id)).toEqual(['destination'])
    expect(state.groupsByWorktree[WT][0].tabClusters).toEqual([cluster('c', ['a', 'b'])])
    expect(state.groupsByWorktree[WT][0].tabOrder).toEqual(['x', 'a', 'b'])
    expect(state.layoutByWorktree[WT]).toEqual({ type: 'leaf', groupId: 'destination' })
    expect(state.tabSelectionByGroupId).toEqual({})
  })

  it('rekeys a carried record if its id is already used in the destination', () => {
    seedPanes(
      ['a', 'b', 'stay'],
      ['x'],
      [cluster('same', ['a', 'b'], { name: 'Source', color: 'pink' })],
      [cluster('same', ['x'], { name: 'Destination' })]
    )
    store.getState().moveTabCluster('source', 'same', { groupId: 'destination' })
    const records = store.getState().groupsByWorktree[WT][1].tabClusters!
    expect(records[0]).toEqual(cluster('same', ['x'], { name: 'Destination' }))
    expect(records[1]).toMatchObject({ name: 'Source', color: 'pink', tabIds: ['a', 'b'] })
    expect(records[1].id).not.toBe('same')
  })

  it('does not create a transient matching split when the entire source already occupies that edge', () => {
    seedPanes(['a', 'b'], ['x'], [cluster('c', ['a', 'b'])])
    const before = store.getState()
    expect(
      store.getState().moveTabCluster('source', 'c', { groupId: 'source', splitDirection: 'right' })
    ).toBe(false)
    expect(
      store
        .getState()
        .moveTabCluster('source', 'c', { groupId: 'destination', splitDirection: 'left' })
    ).toBe(false)
    expect(store.getState()).toBe(before)
  })

  it('rejects unknown panes, missing clusters and cross-worktree destinations', () => {
    seedPanes(['a', 'b'], ['x'], [cluster('c', ['a', 'b'])])
    store.setState((state) => ({
      groupsByWorktree: {
        ...state.groupsByWorktree,
        other: [makeTabGroup({ id: 'foreign', worktreeId: 'other', tabOrder: [] })]
      }
    }))
    const before = store.getState()
    expect(store.getState().moveTabCluster('source', 'c', { groupId: 'missing' })).toBe(false)
    expect(store.getState().moveTabCluster('source', 'missing', { groupId: 'destination' })).toBe(
      false
    )
    expect(store.getState().moveTabCluster('source', 'c', { groupId: 'foreign' })).toBe(false)
    expect(store.getState()).toBe(before)
  })
})
