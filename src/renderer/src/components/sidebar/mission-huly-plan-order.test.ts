import { describe, expect, it } from 'vitest'
import type { HulyPlannedTask } from '../../../../shared/huly/huly-mission-plan'
import { getOrderedStackTasks, getOrderOverrides, moveStackTask } from './mission-huly-plan-order'

function tasks(...identifiers: string[]): HulyPlannedTask[] {
  return identifiers.map((identifier, index) => ({
    repoId: 'r1',
    issue: {
      id: identifier,
      identifier,
      number: index,
      title: identifier,
      url: '',
      status: { name: 'Todo', category: 'ToDo' },
      componentId: null,
      blockedBy: [],
      parentIssueId: null
    }
  }))
}

function getIdentifiers(list: HulyPlannedTask[]): string[] {
  return list.map((task) => task.issue.identifier)
}

describe('getOrderedStackTasks', () => {
  it('appends a task the user has not placed yet after the user order', () => {
    expect(getIdentifiers(getOrderedStackTasks(tasks('A', 'B', 'C'), ['B', 'A']))).toEqual([
      'B',
      'A',
      'C'
    ])
  })

  it('drops identifiers that left the stack and keeps the rest of the user order', () => {
    expect(getIdentifiers(getOrderedStackTasks(tasks('A', 'C'), ['C', 'B', 'A']))).toEqual([
      'C',
      'A'
    ])
  })
})

describe('getOrderOverrides', () => {
  it('sends only stacks whose order differs from Huly', () => {
    const stacks = [
      { repoId: 'r1', tasks: tasks('A', 'B') },
      { repoId: 'r2', tasks: tasks('C', 'D') }
    ]
    const orderByRepo = {
      r1: moveStackTask(stacks[0].tasks, 1, -1),
      r2: ['C', 'D']
    }

    expect(getOrderOverrides(stacks, orderByRepo)).toEqual({ r1: ['B', 'A'] })
  })
})
