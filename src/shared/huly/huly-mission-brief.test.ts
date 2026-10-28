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

function createTask(
  id: string,
  repoId: string,
  order: number,
  externalRef: string
): NonNullable<Mission['tasks']>[number] {
  return {
    id,
    repoId,
    order,
    title: `Task ${externalRef}`,
    branchName: `mission-task/kiosek/${externalRef.toLowerCase()}`,
    worktreeId: null,
    parentBaseSha: null,
    externalRef,
    addedAt: 1
  }
}

const mission: Pick<Mission, 'tasks' | 'branchName'> = {
  branchName: 'mission/kiosek',
  tasks: [createTask('t1', 'r-kiosek', 1, 'OMP-951'), createTask('t2', 'r-kiosek', 2, 'OMP-952')]
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
    expect(markdown).toContain(
      '| 2 | OMP-952 | Pipes \\| here | mission-task/kiosek/omp-952 | In Progress |'
    )
    expect(markdown).toContain('### kiosek')
    expect(markdown).toContain('### admin\n\n_No task layers yet_')
  })

  it('lists plan issues without a task layer apart from the stacks', () => {
    const section = markdown.split('## Not in the stacks')[1].split('## ')[0]
    expect(section).toContain('- OMP-963 Issue 963 (admin)')
    expect(markdown.split('## Not in the stacks')[0]).not.toContain('OMP-963 |')
  })

  it('lists cross-repo dependencies as blocked → blocker', () => {
    const section = markdown.split('## Cross-repo dependencies')[1]
    expect(section).toContain('OMP-963 → OMP-951')
  })

  it('lists skipped issues and orders the sections as specified', () => {
    expect(markdown).toContain('OMP-900')
    const order = [
      '## Stacks',
      '## Cross-repo dependencies',
      '## Not in the stacks',
      '## No longer in the milestone',
      '## Skipped'
    ].map((h) => markdown.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((index) => index > 0)).toBe(true)
  })
})

describe('renderMissionBrief after a refresh', () => {
  it('keeps the user-reordered stack and reports removed and non-appended issues', () => {
    const markdown = renderMissionBrief({
      milestone,
      plan: {
        ...plan,
        stacks: [
          {
            repoId: 'r-kiosek',
            tasks: [
              { repoId: 'r-kiosek', issue: issue(951) },
              { repoId: 'r-kiosek', issue: issue(952) },
              { repoId: 'r-kiosek', issue: issue(953) }
            ]
          }
        ]
      },
      mission: {
        branchName: 'mission/kiosek',
        tasks: [
          createTask('t1', 'r-kiosek', 1, 'OMP-952'),
          createTask('t2', 'r-kiosek', 2, 'OMP-951'),
          createTask('t3', 'r-kiosek', 3, 'OMP-940')
        ]
      },
      repoNames: { 'r-kiosek': 'kiosek' }
    })

    const stacks = markdown.split('## Stacks')[1].split('## Cross-repo')[0]
    expect(stacks.indexOf('| 1 | OMP-952 |')).toBeGreaterThan(0)
    expect(stacks.indexOf('| 2 | OMP-951 |')).toBeGreaterThan(stacks.indexOf('| 1 | OMP-952 |'))
    expect(stacks).toContain('| 3 | OMP-940 | Task OMP-940 | mission-task/kiosek/omp-940 |  |')
    expect(stacks).not.toContain('OMP-953')
    expect(markdown.split('## Not in the stacks')[1]).toContain('- OMP-953 Issue 953 (kiosek)')
    expect(markdown.split('## No longer in the milestone')[1]).toContain(
      '- OMP-940 Task OMP-940 (mission-task/kiosek/omp-940)'
    )
  })
})
