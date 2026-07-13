import { describe, expect, it } from 'vitest'
import {
  getComboboxGroupSelection,
  getVisibleComboboxGroups,
  toggleComboboxGroupSelection
} from './repo-multi-combobox'

describe('getVisibleComboboxGroups', () => {
  const repos = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
  const groups = [
    { id: 'g1', name: 'Platform', repoIds: ['r1', 'r2'] },
    { id: 'g2', name: 'Demo apps', repoIds: ['r3', 'ghost'] },
    { id: 'g3', name: 'Remote only', repoIds: ['ghost'] }
  ]

  it('intersects group repos with the pickable repo list and drops emptied groups', () => {
    expect(getVisibleComboboxGroups(groups, repos, '')).toEqual([
      { id: 'g1', name: 'Platform', repoIds: ['r1', 'r2'] },
      { id: 'g2', name: 'Demo apps', repoIds: ['r3'] }
    ])
  })

  it('filters group rows by the search query', () => {
    expect(getVisibleComboboxGroups(groups, repos, 'plat').map((group) => group.id)).toEqual(['g1'])
    expect(getVisibleComboboxGroups(groups, repos, 'nothing')).toEqual([])
  })
})

describe('toggleComboboxGroupSelection', () => {
  it('adds all group repos when any are missing from the selection', () => {
    expect(toggleComboboxGroupSelection(new Set(), ['r1', 'r2'])).toEqual(new Set(['r1', 'r2']))
    expect(toggleComboboxGroupSelection(new Set(['r1', 'r9']), ['r1', 'r2'])).toEqual(
      new Set(['r1', 'r2', 'r9'])
    )
  })

  it('removes the group when every repo is already selected', () => {
    expect(toggleComboboxGroupSelection(new Set(['r1', 'r2', 'r9']), ['r1', 'r2'])).toEqual(
      new Set(['r9'])
    )
  })

  it('blocks a deselect that would empty the selection', () => {
    expect(toggleComboboxGroupSelection(new Set(['r1', 'r2']), ['r1', 'r2'])).toBeNull()
  })
})

describe('getComboboxGroupSelection', () => {
  it('mirrors child selection as an aggregate state with a count', () => {
    expect(getComboboxGroupSelection(new Set(), ['r1', 'r2'])).toEqual({
      state: 'none',
      selectedCount: 0
    })
    expect(getComboboxGroupSelection(new Set(['r1']), ['r1', 'r2'])).toEqual({
      state: 'partial',
      selectedCount: 1
    })
    expect(getComboboxGroupSelection(new Set(['r1', 'r2', 'r9']), ['r1', 'r2'])).toEqual({
      state: 'all',
      selectedCount: 2
    })
  })
})
