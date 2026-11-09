import { clearMissingMissionMembers } from '../../../shared/missions'
import type { Mission } from '../../../shared/mission-types'

export function sanitizeLoadedMissions(
  result: { missions?: Mission[] },
  repos: Parameters<typeof clearMissingMissionMembers>[1],
  runtime: { loadNeedsSave: boolean }
): void {
  const sanitized = clearMissingMissionMembers(result.missions ?? [], repos)
  result.missions = sanitized.missions
  if (sanitized.changed) {
    runtime.loadNeedsSave = true
  }
}
