import { getRepoTaskStack } from '../mission-task-stack'
import type { Mission } from '../mission-types'
import type { HulyMissionPlan } from './huly-mission-plan'
import type { HulyIssue, HulyMilestone } from './huly-types'

type BriefInput = {
  milestone: HulyMilestone
  plan: HulyMissionPlan
  mission: Pick<Mission, 'tasks' | 'branchName'>
  repoNames: Record<string, string>
}

function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

function line(value: string): string {
  return value.replace(/\r?\n/g, ' ')
}

function getPlanIssues(plan: HulyMissionPlan): Map<string, HulyIssue> {
  const issues = [
    ...plan.stacks.flatMap((stack) => stack.tasks.map((task) => task.issue)),
    ...plan.unmapped,
    ...plan.skipped
  ]
  return new Map(issues.map((issue) => [issue.identifier, issue]))
}

/** Rows follow the Mission's real stack, so user reorders and skipped layers show as they are. */
function renderStack(repoId: string, input: BriefInput, issues: Map<string, HulyIssue>): string {
  const rows = getRepoTaskStack(input.mission, repoId).map((task, index) => {
    const issue = task.externalRef ? issues.get(task.externalRef) : undefined
    return [
      index + 1,
      task.externalRef ?? '',
      cell(issue?.title ?? task.title),
      cell(task.branchName),
      cell(issue?.status.name ?? '')
    ].join(' | ')
  })
  const heading = `### ${input.repoNames[repoId] ?? repoId}`
  if (rows.length === 0) {
    return [heading, '_No task layers yet_'].join('\n\n')
  }
  return [
    heading,
    '',
    '| Order | Issue | Title | Branch | Huly status |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`)
  ].join('\n')
}

function getNotAddedLines(input: BriefInput, taskRefs: Set<string>): string[] {
  const { plan, repoNames } = input
  const repoName = (repoId: string) => repoNames[repoId] ?? repoId
  const entries = [
    ...plan.stacks.flatMap((stack) =>
      stack.tasks.map(({ issue }) => ({
        identifier: issue.identifier,
        text: `${line(issue.title)} (${repoName(stack.repoId)})`
      }))
    ),
    ...plan.cycles.flatMap((cycle) =>
      cycle.identifiers.map((identifier) => ({
        identifier,
        text: `(blocked-by cycle in ${repoName(cycle.repoId)})`
      }))
    ),
    ...plan.unmapped.map((issue) => ({
      identifier: issue.identifier,
      text: `${line(issue.title)} (no repository)`
    }))
  ]
  return entries.flatMap(({ identifier, text }) =>
    taskRefs.has(identifier) ? [] : [`- ${identifier} ${text}`]
  )
}

function getRemovedLines(input: BriefInput, issues: Map<string, HulyIssue>): string[] {
  const cycleIdentifiers = new Set(input.plan.cycles.flatMap((cycle) => cycle.identifiers))
  return (input.mission.tasks ?? []).flatMap((task) =>
    task.externalRef && !issues.has(task.externalRef) && !cycleIdentifiers.has(task.externalRef)
      ? [`- ${task.externalRef} ${line(task.title)} (${task.branchName})`]
      : []
  )
}

function section(heading: string, lines: string[]): string[] {
  return [heading, lines.length > 0 ? lines.join('\n') : '_None_']
}

/** The brief agents read from `ORCA_MISSION_BRIEF`; regenerated, never edited in place. */
export function renderMissionBrief(input: BriefInput): string {
  const { milestone, plan, mission } = input
  const issues = getPlanIssues(plan)
  const taskRefs = new Set((mission.tasks ?? []).flatMap((task) => task.externalRef ?? []))
  const repoIds = [
    ...new Set([
      ...plan.stacks.map((stack) => stack.repoId),
      ...(mission.tasks ?? []).map((task) => task.repoId)
    ])
  ].sort()
  const stacks = repoIds.map((repoId) => renderStack(repoId, input, issues))
  const dependencies = plan.crossRepoDependencies.map(({ from, to }) => `- ${from} → ${to}`)
  const skipped = plan.skipped.map(
    (issue) => `- ${issue.identifier} ${line(issue.title)} (${issue.status.name})`
  )
  const body = [
    `# ${milestone.label}`,
    `[Open in Huly](${milestone.url})`,
    milestone.descriptionMarkdown,
    '## Stacks',
    ...(stacks.length > 0 ? stacks : ['_None_']),
    '## Cross-repo dependencies',
    'Each line reads blocked → blocker.',
    dependencies.length > 0 ? dependencies.join('\n') : '_None_',
    ...section('## Not in the stacks', getNotAddedLines(input, taskRefs)),
    ...section('## No longer in the milestone', getRemovedLines(input, issues)),
    ...section('## Skipped', skipped)
  ].join('\n\n')
  return `${body}\n`
}
