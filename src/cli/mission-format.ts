import type { MissionRestackLayer } from '../shared/mission-layer-state'
import type {
  MissionMemberResult,
  RuntimeMissionAbsorbResult,
  RuntimeMissionHulyCreateResult,
  RuntimeMissionHulyRefreshResult,
  RuntimeMissionLayerRecord,
  RuntimeMissionList,
  RuntimeMissionMutationResult,
  RuntimeMissionRecord,
  RuntimeMissionRemoveResult,
  RuntimeMissionRestackResult,
  RuntimeMissionShow,
  RuntimeMissionTaskResult
} from '../shared/mission-types'

function formatLayerState(layer: Pick<MissionRestackLayer, 'state' | 'reason'>): string {
  return layer.reason ? `${layer.state} (${layer.reason})` : layer.state
}

function formatStackLayer(layer: RuntimeMissionLayerRecord): string {
  return [
    layer.slot,
    layer.externalRef ?? layer.title,
    layer.state ? formatLayerState({ state: layer.state, reason: layer.reason }) : null,
    layer.branch,
    layer.worktreePath ?? '(no worktree)'
  ]
    .filter((part) => part !== null)
    .join('  ')
}

function formatMissionRecord(mission: RuntimeMissionRecord): string {
  const lines = [
    `id: ${mission.id}`,
    `name: ${mission.name}`,
    `branch: ${mission.branch}`,
    `rootPath: ${mission.rootPath ?? '(not created)'}`,
    ...(mission.briefPath ? [`brief: ${mission.briefPath}`] : []),
    `members: ${mission.members.length}`
  ]
  for (const member of mission.members) {
    const repo = member.repoName ? `${member.repoName} (${member.repoId})` : member.repoId
    const location = member.worktreePath ?? '(no worktree)'
    lines.push(`  - ${repo}  ${location}  ${member.branch}`)
    if (member.error) {
      lines.push(`    error: ${member.error}`)
    }
  }
  if (mission.orchestrator) {
    lines.push(
      `orchestrator: ${mission.orchestrator.repoId}  ${mission.orchestrator.worktreePath ?? '(no worktree)'}  ${mission.orchestrator.branch}`
    )
    if (mission.orchestrator.error) {
      lines.push(`  error: ${mission.orchestrator.error}`)
    }
  }
  // Why: layers are stored bottom-up, so reading top to bottom matches the stack's order.
  for (const stack of mission.stacks ?? []) {
    const repo = stack.repoName ? `${stack.repoName} (${stack.repoId})` : stack.repoId
    lines.push(`stack ${repo}:`)
    lines.push(...stack.layers.map((layer) => `  ${formatStackLayer(layer)}`))
  }
  return lines.join('\n')
}

function formatMemberResults(results: MissionMemberResult[]): string[] {
  return results.flatMap((result) => [
    ...(result.error ? [`error (${result.repoId}): ${result.error}`] : []),
    ...(result.warning ? [`warning (${result.repoId}): ${result.warning}`] : [])
  ])
}

export function formatMissionList(result: RuntimeMissionList): string {
  if (result.missions.length === 0) {
    return 'No missions found.'
  }
  return result.missions
    .map(
      (mission) =>
        `${mission.id}  ${mission.name}  ${mission.branch}  ${mission.members.length} repos  ${mission.rootPath ?? '(no root)'}`
    )
    .join('\n')
}

export function formatMissionShow(result: RuntimeMissionShow): string {
  return formatMissionRecord(result.mission)
}

export function formatMissionMutation(result: RuntimeMissionMutationResult): string {
  return [
    formatMissionRecord(result.mission),
    ...formatMemberResults([
      ...result.memberResults,
      ...(result.orchestratorResult ? [result.orchestratorResult] : [])
    ])
  ].join('\n')
}

export function formatMissionHulyCreate(result: RuntimeMissionHulyCreateResult): string {
  return [
    formatMissionRecord(result.mission),
    ...result.warnings.map((warning) => `warning: ${warning}`)
  ].join('\n')
}

export function formatMissionHulyRefresh(result: RuntimeMissionHulyRefreshResult): string {
  const { diff } = result
  const sections: [string, string[]][] = [
    [
      'Appendable',
      diff.appendable.flatMap(({ repoId, issues }) =>
        issues.map((issue) => `${issue.identifier}  ${issue.title}  (${repoId})`)
      )
    ],
    [
      'Non-appendable',
      diff.nonAppendable.map(
        ({ identifier, repoId, reason }) => `${identifier}  ${repoId}  ${reason}`
      )
    ],
    [
      'Reordered in Huly',
      diff.reorderedInHuly.map(
        ({ repoId, before, after }) => `${repoId}: ${before.join(', ')} -> ${after.join(', ')}`
      )
    ],
    [
      'Moved repo',
      diff.movedRepo.map(
        ({ identifier, fromRepoId, toRepoId }) => `${identifier}  ${fromRepoId} -> ${toRepoId}`
      )
    ],
    ['Removed', diff.removed]
  ]
  const lines = sections.flatMap(([title, entries]) =>
    entries.length > 0 ? [`${title}:`, ...entries.map((entry) => `  ${entry}`)] : []
  )
  return [
    ...(lines.length > 0 ? lines : ['Mission is up to date with its milestone.']),
    ...(result.applied.length > 0 ? [`Appended: ${result.applied.join(', ')}`] : []),
    ...result.warnings.map((warning) => `warning: ${warning}`)
  ].join('\n')
}

export function formatMissionRemove(result: RuntimeMissionRemoveResult): string {
  const headline = result.deleted
    ? `Deleted mission ${result.missionId}.`
    : `Mission ${result.missionId} was not deleted.`
  return [
    headline,
    ...(result.error ? [`error: ${result.error}`] : []),
    // Why: member warnings are already folded into result.warning.
    ...[
      ...result.memberResults,
      ...(result.orchestratorResult ? [result.orchestratorResult] : [])
    ].flatMap((member) => (member.error ? [`error (${member.repoId}): ${member.error}`] : [])),
    ...(result.warning ? [`warning: ${result.warning}`] : [])
  ].join('\n')
}

export function formatMissionTask(result: RuntimeMissionTaskResult): string {
  return [
    ...(result.task
      ? [`task: ${result.task.externalRef ?? result.task.title}  ${result.task.branch}`]
      : []),
    ...(result.error ? [`error: ${result.error}`] : []),
    ...(result.warning ? [`warning: ${result.warning}`] : []),
    formatMissionRecord(result.mission)
  ].join('\n')
}

export function formatMissionRestack(result: RuntimeMissionRestackResult): string {
  if (result.reports.length === 0) {
    return 'Nothing to restack.'
  }
  return result.reports
    .flatMap((report) => [
      `repo ${report.repoId}:`,
      ...report.layers.map((layer) => `  ${layer.slot}  ${formatLayerState(layer)}`)
    ])
    .join('\n')
}

export function formatMissionAbsorb(result: RuntimeMissionAbsorbResult): string {
  const lines = [`Absorbed ${result.applied} edit${result.applied === 1 ? '' : 's'}.`]
  if (result.ambiguous.length > 0) {
    lines.push('Ambiguous hunks; choose the owning task with --choose <file:line=taskRef>:')
    for (const hunk of result.ambiguous) {
      const candidates = hunk.candidateRefs ?? hunk.candidateTaskIds
      lines.push(`  ${hunk.file}:${hunk.line}  candidates: ${candidates.join(', ')}`)
    }
  }
  if (result.warning) {
    lines.push(`warning: ${result.warning}`)
  }
  return lines.join('\n')
}
