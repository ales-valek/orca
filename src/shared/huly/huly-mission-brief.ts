import type { Mission } from '../mission-types'
import type { HulyMissionPlan } from './huly-mission-plan'
import type { HulyMilestone } from './huly-types'

type BriefInput = {
  milestone: HulyMilestone
  plan: HulyMissionPlan
  mission: Pick<Mission, 'tasks' | 'branchName'>
  repoNames: Record<string, string>
}

function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

function renderStack(stack: HulyMissionPlan['stacks'][number], input: BriefInput): string {
  const branchByRef = new Map(
    (input.mission.tasks ?? [])
      .filter((task) => task.repoId === stack.repoId && task.externalRef)
      .map((task) => [task.externalRef, task.branchName])
  )
  const rows = stack.tasks.map(({ issue }, index) =>
    [
      index + 1,
      issue.identifier,
      cell(issue.title),
      cell(branchByRef.get(issue.identifier) ?? ''),
      cell(issue.status.name)
    ].join(' | ')
  )
  return [
    `### ${input.repoNames[stack.repoId] ?? stack.repoId}`,
    '',
    '| Order | Issue | Title | Branch | Huly status |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`)
  ].join('\n')
}

/** The brief agents read from `ORCA_MISSION_BRIEF`; regenerated, never edited in place. */
export function renderMissionBrief(input: BriefInput): string {
  const { milestone, plan } = input
  const stacks = plan.stacks.length > 0 ? plan.stacks.map((s) => renderStack(s, input)) : ['_None_']
  const dependencies = plan.crossRepoDependencies.map(({ from, to }) => `- ${from} → ${to}`)
  const skipped = plan.skipped.map(
    (issue) => `- ${issue.identifier} ${issue.title} (${issue.status.name})`
  )
  const body = [
    `# ${milestone.label}`,
    `[Open in Huly](${milestone.url})`,
    milestone.descriptionMarkdown,
    '## Stacks',
    ...stacks,
    '## Cross-repo dependencies',
    'Each line reads blocked → blocker.',
    dependencies.length > 0 ? dependencies.join('\n') : '_None_',
    '## Skipped',
    skipped.length > 0 ? skipped.join('\n') : '_None_'
  ].join('\n\n')
  return `${body}\n`
}
