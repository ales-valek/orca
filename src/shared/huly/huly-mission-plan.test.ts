import { describe, expect, it } from 'vitest'
import { buildMissionPlanFromMilestone } from './huly-mission-plan'
import type { HulyProjectSettings } from './huly-project-settings'
import type { HulyIssue, HulyStatus } from './huly-types'

const TODO: HulyStatus = { name: 'Todo', category: 'ToDo' }

function issue(number: number, overrides: Partial<HulyIssue> = {}): HulyIssue {
  return {
    id: `id-${number}`,
    identifier: `OMP-${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://huly.test/OMP-${number}`,
    status: TODO,
    componentId: 'c-eshop',
    blockedBy: [],
    parentIssueId: null,
    ...overrides
  }
}

const NO_RULE = { target: null, fromStatusNames: [], fromCategories: [] }

function makeSettings(): HulyProjectSettings {
  return {
    componentRepoMap: { 'c-eshop': 'eshop', 'c-admin': 'admin' },
    skipStatusNames: ['MERGED IN MILESTONE'],
    statusWriteBack: false,
    statusRules: {
      'layer-created': NO_RULE,
      'stack-pr-created': NO_RULE,
      'stack-merged': NO_RULE
    }
  }
}

function ids(tasks: { issue: HulyIssue }[]): string[] {
  return tasks.map((task) => task.issue.identifier)
}

describe('buildMissionPlanFromMilestone', () => {
  it('orders an eshop stack by blockedBy with ties broken by number', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [
        issue(978, { blockedBy: ['OMP-955'] }),
        issue(976, { blockedBy: ['OMP-951'] }),
        issue(955, { blockedBy: ['OMP-976'] }),
        issue(957, { blockedBy: ['OMP-951'] }),
        issue(953, { blockedBy: ['OMP-951'] }),
        issue(951)
      ],
      settings: makeSettings()
    })
    expect(plan.stacks).toHaveLength(1)
    expect(plan.stacks[0].repoId).toBe('eshop')
    expect(ids(plan.stacks[0].tasks)).toEqual([
      'OMP-951',
      'OMP-953',
      'OMP-957',
      'OMP-976',
      'OMP-955',
      'OMP-978'
    ])
    expect(plan.stacks[0].tasks.every((task) => task.repoId === 'eshop')).toBe(true)
  })

  it('places a lower-numbered issue after the higher-numbered issue blocking it', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [issue(1, { blockedBy: ['OMP-5'] }), issue(5)],
      settings: makeSettings()
    })
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-5', 'OMP-1'])
  })

  it('ignores an issue blocking itself', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [issue(1, { blockedBy: ['OMP-1'] })],
      settings: makeSettings()
    })
    expect(plan.cycles).toEqual([])
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-1'])
  })

  it('returns empty arrays for an empty milestone', () => {
    expect(buildMissionPlanFromMilestone({ issues: [], settings: makeSettings() })).toEqual({
      stacks: [],
      unmapped: [],
      skipped: [],
      cycles: [],
      crossRepoDependencies: []
    })
  })

  it('reports a cycle even when orderOverrides is a valid permutation', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [issue(1, { blockedBy: ['OMP-2'] }), issue(2, { blockedBy: ['OMP-1'] })],
      settings: makeSettings(),
      orderOverrides: { eshop: ['OMP-2', 'OMP-1'] }
    })
    expect(plan.cycles).toEqual([{ repoId: 'eshop', identifiers: ['OMP-1', 'OMP-2'] }])
    expect(plan.stacks).toEqual([])
  })

  it('puts MERGED IN MILESTONE, Won and Lost issues into skipped', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [
        issue(2, { status: { name: 'MERGED IN MILESTONE', category: 'Active' } }),
        issue(1, { status: { name: 'Done', category: 'Won' } }),
        issue(4, { status: { name: 'Canceled', category: 'Lost' } }),
        issue(3)
      ],
      settings: makeSettings()
    })
    expect(plan.skipped.map((entry) => entry.identifier)).toEqual(['OMP-1', 'OMP-2', 'OMP-4'])
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-3'])
  })

  it('places an issue blocked only by a skipped issue', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [
        issue(1, { status: { name: 'MERGED IN MILESTONE', category: 'Active' } }),
        issue(2, { blockedBy: ['OMP-1'] })
      ],
      settings: makeSettings()
    })
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-2'])
  })

  it('ignores blockers outside the milestone', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [issue(2, { blockedBy: ['OMP-999'] })],
      settings: makeSettings()
    })
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-2'])
    expect(plan.crossRepoDependencies).toEqual([])
  })

  it('reports a cycle and excludes only that repo from stacks', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [
        issue(2, { identifier: 'B', blockedBy: ['A'] }),
        issue(1, { identifier: 'A', blockedBy: ['B'] }),
        issue(10, { componentId: 'c-admin' })
      ],
      settings: makeSettings()
    })
    expect(plan.cycles).toEqual([{ repoId: 'eshop', identifiers: ['A', 'B'] }])
    expect(plan.stacks.map((stack) => stack.repoId)).toEqual(['admin'])
  })

  it('lists issues without a mapped component as unmapped', () => {
    const issues = [
      issue(1, { componentId: null }),
      issue(2, { componentId: 'c-unknown' }),
      issue(3)
    ]
    const plan = buildMissionPlanFromMilestone({ issues, settings: makeSettings() })
    expect(plan.unmapped.map((entry) => entry.identifier)).toEqual(['OMP-1', 'OMP-2'])
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-3'])
  })

  it('moves an unmapped issue into a stack with repoOverrides', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [issue(1, { componentId: null }), issue(3)],
      settings: makeSettings(),
      repoOverrides: { 'OMP-1': 'eshop' }
    })
    expect(plan.unmapped).toEqual([])
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-1', 'OMP-3'])
  })

  it('lets repoOverrides win over componentRepoMap', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [issue(1), issue(2)],
      settings: makeSettings(),
      repoOverrides: { 'OMP-2': 'admin' }
    })
    expect(plan.stacks.map((stack) => [stack.repoId, ids(stack.tasks)])).toEqual([
      ['admin', ['OMP-2']],
      ['eshop', ['OMP-1']]
    ])
  })

  it('lists cross-repo dependencies without affecting stack order', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [
        issue(5, { componentId: 'c-admin', blockedBy: ['OMP-9'] }),
        issue(4, { componentId: 'c-admin' }),
        issue(9)
      ],
      settings: makeSettings()
    })
    expect(plan.crossRepoDependencies).toEqual([{ from: 'OMP-5', to: 'OMP-9' }])
    const admin = plan.stacks.find((stack) => stack.repoId === 'admin')
    expect(ids(admin?.tasks ?? [])).toEqual(['OMP-4', 'OMP-5'])
  })

  it('drops sub-issues everywhere', () => {
    const plan = buildMissionPlanFromMilestone({
      issues: [
        issue(1),
        issue(2, { parentIssueId: 'id-1', componentId: null }),
        issue(3, { parentIssueId: 'id-1', status: { name: 'Done', category: 'Won' } })
      ],
      settings: makeSettings()
    })
    expect(ids(plan.stacks[0].tasks)).toEqual(['OMP-1'])
    expect(plan.unmapped).toEqual([])
    expect(plan.skipped).toEqual([])
  })

  it('applies orderOverrides only when it is an exact permutation', () => {
    const issues = [issue(1), issue(2), issue(3)]
    const applied = buildMissionPlanFromMilestone({
      issues,
      settings: makeSettings(),
      orderOverrides: { eshop: ['OMP-3', 'OMP-1', 'OMP-2'] }
    })
    expect(ids(applied.stacks[0].tasks)).toEqual(['OMP-3', 'OMP-1', 'OMP-2'])

    for (const bad of [
      ['OMP-3', 'OMP-1'],
      ['OMP-1', 'OMP-1', 'OMP-2'],
      ['OMP-1', 'OMP-2', 'X']
    ]) {
      const ignored = buildMissionPlanFromMilestone({
        issues,
        settings: makeSettings(),
        orderOverrides: { eshop: bad }
      })
      expect(ids(ignored.stacks[0].tasks)).toEqual(['OMP-1', 'OMP-2', 'OMP-3'])
    }
  })
})
