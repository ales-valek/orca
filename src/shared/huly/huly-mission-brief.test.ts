import { describe, expect, it } from 'vitest'
import type { Mission } from '../mission-types'
import { renderMissionBrief } from './huly-mission-brief'
import type { HulyMissionPlan } from './huly-mission-plan'
import type { HulyIssue, HulyMilestone } from './huly-types'

function issue(number: number, overrides: Partial<HulyIssue> = {}): HulyIssue {
  return {
    id: `id-${number}`,
    identifier: `OMP-${number}`,
    number,
    title: `Issue ${number}`,
    url: `https://huly.test/OMP-${number}`,
    status: { name: 'In Progress', category: 'Active' },
    componentId: null,
    blockedBy: [],
    parentIssueId: null,
    ...overrides
  }
}

const milestone: HulyMilestone = {
  id: 'ms1',
  label: 'Kiosek launch',
  status: 'InProgress',
  descriptionMarkdown: 'Ship the kiosk.\n\n- keep `inline | code` as-is',
  url: 'https://huly.test/milestone/ms1'
}

const plan: HulyMissionPlan = {
  stacks: [
    {
      repoId: 'r-kiosek',
      tasks: [
        { repoId: 'r-kiosek', issue: issue(951) },
        { repoId: 'r-kiosek', issue: issue(952, { title: 'Pipes | here' }) }
      ]
    },
    { repoId: 'r-admin', tasks: [{ repoId: 'r-admin', issue: issue(963) }] }
  ],
  unmapped: [],
  skipped: [issue(900, { status: { name: 'Done', category: 'Won' } })],
  cycles: [],
  crossRepoDependencies: [{ from: 'OMP-963', to: 'OMP-951' }]
}

const mission: Pick<Mission, 'tasks' | 'branchName'> = {
  branchName: 'mission/kiosek',
  tasks: [
    {
      id: 't1',
      repoId: 'r-kiosek',
      order: 1,
      title: 'Issue 951',
      branchName: 'mission-task/kiosek/omp-951',
      worktreeId: null,
      parentBaseSha: null,
      externalRef: 'OMP-951',
      addedAt: 1
    }
  ]
}

describe('renderMissionBrief', () => {
  const markdown = renderMissionBrief({
    milestone,
    plan,
    mission,
    repoNames: { 'r-kiosek': 'kiosek', 'r-admin': 'admin' }
  })

  it('starts with the milestone heading and the Huly link', () => {
    expect(markdown.startsWith('# Kiosek launch\n')).toBe(true)
    expect(markdown).toContain('https://huly.test/milestone/ms1')
  })

  it('keeps the milestone description verbatim', () => {
    expect(markdown).toContain(milestone.descriptionMarkdown)
  })

  it('renders one stack table per repo with the task branch and Huly status', () => {
    expect(markdown).toContain('| Order | Issue | Title | Branch | Huly status |')
    expect(markdown).toContain(
      '| 1 | OMP-951 | Issue 951 | mission-task/kiosek/omp-951 | In Progress |'
    )
    expect(markdown).toContain('### kiosek')
    expect(markdown).toContain('### admin')
  })

  it('escapes table pipes and leaves the branch blank before the layer exists', () => {
    expect(markdown).toContain('| 2 | OMP-952 | Pipes \\| here |  | In Progress |')
  })

  it('lists cross-repo dependencies as blocked → blocker', () => {
    const section = markdown.split('## Cross-repo dependencies')[1]
    expect(section).toContain('OMP-963 → OMP-951')
  })

  it('lists skipped issues and orders the sections as specified', () => {
    expect(markdown).toContain('OMP-900')
    const order = ['## Stacks', '## Cross-repo dependencies', '## Skipped'].map((h) =>
      markdown.indexOf(h)
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((index) => index > 0)).toBe(true)
  })
})
