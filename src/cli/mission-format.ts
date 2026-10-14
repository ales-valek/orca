import type {
  MissionMemberResult,
  RuntimeMissionList,
  RuntimeMissionMutationResult,
  RuntimeMissionRecord,
  RuntimeMissionRemoveResult,
  RuntimeMissionShow
} from '../shared/mission-types'

function formatMissionRecord(mission: RuntimeMissionRecord): string {
  const lines = [
    `id: ${mission.id}`,
    `name: ${mission.name}`,
    `branch: ${mission.branch}`,
    `rootPath: ${mission.rootPath ?? '(not created)'}`,
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
  return [formatMissionRecord(result.mission), ...formatMemberResults(result.memberResults)].join(
    '\n'
  )
}

export function formatMissionRemove(result: RuntimeMissionRemoveResult): string {
  const headline = result.deleted
    ? `Deleted mission ${result.missionId}.`
    : `Mission ${result.missionId} was not deleted.`
  return [
    headline,
    ...(result.error ? [`error: ${result.error}`] : []),
    // Why: member warnings are already folded into result.warning.
    ...result.memberResults.flatMap((member) =>
      member.error ? [`error (${member.repoId}): ${member.error}`] : []
    ),
    ...(result.warning ? [`warning: ${result.warning}`] : [])
  ].join('\n')
}
