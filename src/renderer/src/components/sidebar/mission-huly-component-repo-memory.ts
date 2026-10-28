import type { HulyIssue } from '../../../../shared/huly/huly-types'
import type { MissionHulyPlanPicks } from './MissionHulyPlanView'

/** The component map with the remembered picks applied, or null when nothing changes. */
export function getRememberedComponentRepoMap(
  current: Record<string, string>,
  unmapped: readonly HulyIssue[],
  picks: MissionHulyPlanPicks
): Record<string, string> | null {
  const next = { ...current }
  let changed = false
  for (const issue of unmapped) {
    const repoId = picks.repoOverrides[issue.identifier]
    if (
      issue.componentId !== null &&
      repoId &&
      picks.remembered.has(issue.identifier) &&
      next[issue.componentId] !== repoId
    ) {
      next[issue.componentId] = repoId
      changed = true
    }
  }
  return changed ? next : null
}
