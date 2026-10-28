import { describe, expect, it } from 'vitest'
import type { Mission, MissionSource, MissionTask } from '../mission-types'
import { diffMissionAgainstPlan } from './huly-mission-refresh'
import { buildMissionPlanFromMilestone } from './huly-mission-plan'
import type { HulyProjectSettings } from './huly-project-settings'
import type { HulyIssue, HulyStatus } from './huly-types'

const TODO: HulyStatus = { name: 'Todo', category: 'ToDo' }
const MERGED: HulyStatus = { name: 'MERGED IN MILESTONE', category: 'Active' }
const NO_RULE = { target: null, fromStatusNames: [], fromCategories: [] }

const SETTINGS: HulyProjectSettings = {
  componentRepoMap: { 'c-eshop': 'eshop', 'c-admin': 'admin', 'c-blog': 'blog' },
  skipStatusNames: ['MERGED IN MILESTONE'],
  statusWriteBack: false,
  statusRules: {
    'layer-created': NO_RULE,
    'stack-pr-created': NO_RULE,
    'stack-merged': NO_RULE
  }
}

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

function task(repoId: string, ref: string, order: number): MissionTask {
  return {
    id: `task-${ref}`,
    repoId,
    order,
    title: ref,
    branchName: `mission-task/x/${ref}`,
    worktreeId: null,
    parentBaseSha: null,
    externalRef: ref,
    addedAt: 1
  }
}

function makeMission(
  tasks: MissionTask[],
  importedOrder: Record<string, string[]>,
  extra: Partial<MissionSource> = {},
  repoIds = ['eshop', 'admin']
): Pick<Mission, 'tasks' | 'source' | 'members'> {
  return {
    members: repoIds.map((repoId) => ({ repoId, worktreeId: null, addedAt: 1 })),
    tasks,
    source: {
      provider: 'huly',
      serverUrl: 'https://huly.test',
      workspace: 'ws',
      project: 'OMP',
      milestoneId: 'ms',
      milestoneLabel: 'Kiosek',
      milestoneUrl: 'u',
      importedOrder,
      lastSyncedAt: 1,
      ...extra
    }
  }
}

function plan(issues: HulyIssue[], repoOverrides?: Record<string, string>) {
  return buildMissionPlanFromMilestone({ issues, settings: SETTINGS, repoOverrides })
}

describe('diffMissionAgainstPlan', () => {
  const base = [issue(1), issue(2, { blockedBy: ['OMP-1'] })]
  const baseMission = makeMission([task('eshop', 'OMP-1', 1), task('eshop', 'OMP-2', 2)], {
    eshop: ['OMP-1', 'OMP-2']
  })

  it('reports no changes when Huly is unchanged', () => {
    expect(diffMissionAgainstPlan(baseMission, plan(base))).toEqual({
      appendable: [],
      reorderedInHuly: [],
      removed: [],
      movedRepo: [],
      nonAppendable: []
    })
  })

  it('appends a new issue blocked by the current top task', () => {
    const added = issue(3, { blockedBy: ['OMP-2'] })
    const diff = diffMissionAgainstPlan(baseMission, plan([...base, added]))
    expect(diff.appendable).toEqual([{ repoId: 'eshop', issues: [added] }])
    expect(diff.nonAppendable).toEqual([])
  })

  it('keeps plan order for several appendable issues in one repo', () => {
    const three = issue(3, { blockedBy: ['OMP-2'] })
    const four = issue(4, { blockedBy: ['OMP-3'] })
    const diff = diffMissionAgainstPlan(baseMission, plan([four, ...base, three]))
    expect(diff.appendable[0].issues.map((entry) => entry.identifier)).toEqual(['OMP-3', 'OMP-4'])
  })

  it('marks a new issue that blocks an existing task as non-appendable', () => {
    const blocker = issue(5)
    const items = [issue(1), issue(2, { blockedBy: ['OMP-1', 'OMP-5'] }), blocker]
    const diff = diffMissionAgainstPlan(baseMission, plan(items))
    expect(diff.appendable).toEqual([])
    expect(diff.nonAppendable).toEqual([
      { repoId: 'eshop', identifier: 'OMP-5', reason: 'inserted-in-middle' }
    ])
  })

  it('marks a new issue for a repo that is not a Mission member as non-appendable', () => {
    const items = [...base, issue(9, { componentId: 'c-blog' })]
    const diff = diffMissionAgainstPlan(baseMission, plan(items))
    expect(diff.nonAppendable).toEqual([
      { repoId: 'blog', identifier: 'OMP-9', reason: 'repo-not-in-mission' }
    ])
  })

  it('reports an issue moved to a skipped status as removed', () => {
    const items = [issue(1), issue(2, { status: MERGED })]
    expect(diffMissionAgainstPlan(baseMission, plan(items)).removed).toEqual(['OMP-2'])
  })

  it('reports an issue that left the milestone as removed', () => {
    expect(diffMissionAgainstPlan(baseMission, plan([issue(1)])).removed).toEqual(['OMP-2'])
  })

  it('reports a component change as movedRepo', () => {
    const items = [issue(1), issue(2, { blockedBy: ['OMP-1'], componentId: 'c-admin' })]
    const diff = diffMissionAgainstPlan(baseMission, plan(items))
    expect(diff.movedRepo).toEqual([
      { identifier: 'OMP-2', fromRepoId: 'eshop', toRepoId: 'admin' }
    ])
    expect(diff.removed).toEqual([])
    expect(diff.appendable).toEqual([])
    expect(diff.nonAppendable).toEqual([])
  })

  it('compares the new Huly order with importedOrder, not with the overridden stack', () => {
    const items = [issue(1), issue(2), issue(3)]
    const overridden = makeMission(
      [task('eshop', 'OMP-1', 1), task('eshop', 'OMP-3', 2), task('eshop', 'OMP-2', 3)],
      { eshop: ['OMP-1', 'OMP-2', 'OMP-3'] }
    )
    expect(diffMissionAgainstPlan(overridden, plan(items)).reorderedInHuly).toEqual([])
  })

  it('reports a Huly reorder relative to importedOrder', () => {
    const items = [issue(1, { blockedBy: ['OMP-2'] }), issue(2)]
    const diff = diffMissionAgainstPlan(baseMission, plan(items))
    expect(diff.reorderedInHuly).toEqual([
      { repoId: 'eshop', before: ['OMP-1', 'OMP-2'], after: ['OMP-2', 'OMP-1'] }
    ])
  })

  it('does not report a moved-by-hand issue when the creation repoOverrides are stored', () => {
    const items = [issue(1), issue(2)]
    const mission = makeMission(
      [task('eshop', 'OMP-1', 1), task('admin', 'OMP-2', 1)],
      { eshop: ['OMP-1'], admin: ['OMP-2'] },
      { repoOverrides: { 'OMP-2': 'admin' } }
    )
    const withOverrides = plan(items, mission.source?.repoOverrides)
    expect(diffMissionAgainstPlan(mission, withOverrides).movedRepo).toEqual([])
    expect(diffMissionAgainstPlan(mission, plan(items)).movedRepo).toEqual([
      { identifier: 'OMP-2', fromRepoId: 'admin', toRepoId: 'eshop' }
    ])
  })

  it('ignores an issue already in importedOrder whose task the user removed', () => {
    const mission = makeMission([task('eshop', 'OMP-1', 1)], { eshop: ['OMP-1', 'OMP-2'] })
    const diff = diffMissionAgainstPlan(mission, plan(base))
    expect(diff.appendable).toEqual([])
    expect(diff.nonAppendable).toEqual([])
  })
})
