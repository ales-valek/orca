import type { HulyMissionEvent, HulyStatusRule } from './huly-project-settings'
import type { HulyStatus } from './huly-types'

/** An Orca-initiated Mission change that may move the linked Huly issues. */
export type MissionEvent = { kind: HulyMissionEvent; missionId: string; taskIds: string[] }

function isSameStatusName(left: string, right: string): boolean {
  // Huly treats status names as case-insensitive.
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

/** Target status to write, or null when the rule must not touch the issue. */
export function resolveStatusTransition(rule: HulyStatusRule, current: HulyStatus): string | null {
  if (rule.target === null || isSameStatusName(current.name, rule.target)) {
    return null
  }
  const isInFromSet =
    rule.fromCategories.includes(current.category) ||
    rule.fromStatusNames.some((name) => isSameStatusName(name, current.name))
  return isInFromSet ? rule.target : null
}
