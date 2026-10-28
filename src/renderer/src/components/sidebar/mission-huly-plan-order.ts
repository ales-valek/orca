import type { HulyMissionPlan, HulyPlannedTask } from '../../../../shared/huly/huly-mission-plan'

/**
 * The user's order for the tasks still in the stack, then tasks the user has not placed yet in
 * Huly's order; without a user order, Huly's order.
 */
export function getOrderedStackTasks(
  tasks: readonly HulyPlannedTask[],
  order: readonly string[] | undefined
): HulyPlannedTask[] {
  if (!order) {
    return [...tasks]
  }
  const byIdentifier = new Map(tasks.map((task) => [task.issue.identifier, task]))
  const placed = [...new Set(order)].flatMap((identifier) => byIdentifier.get(identifier) ?? [])
  const placedIdentifiers = new Set(placed.map((task) => task.issue.identifier))
  return [...placed, ...tasks.filter((task) => !placedIdentifiers.has(task.issue.identifier))]
}

/** Identifiers in stack order after moving the task at `index` one step. */
export function moveStackTask(
  tasks: readonly HulyPlannedTask[],
  index: number,
  offset: -1 | 1
): string[] {
  const identifiers = tasks.map((task) => task.issue.identifier)
  const target = index + offset
  if (target < 0 || target >= identifiers.length) {
    return identifiers
  }
  ;[identifiers[index], identifiers[target]] = [identifiers[target], identifiers[index]]
  return identifiers
}

/** Only stacks the user reordered, so the rest keep following Huly. */
export function getOrderOverrides(
  stacks: HulyMissionPlan['stacks'],
  orderByRepo: Record<string, string[]>
): Record<string, string[]> {
  const overrides: Record<string, string[]> = {}
  for (const stack of stacks) {
    const ordered = getOrderedStackTasks(stack.tasks, orderByRepo[stack.repoId]).map(
      (task) => task.issue.identifier
    )
    if (ordered.some((identifier, index) => identifier !== stack.tasks[index].issue.identifier)) {
      overrides[stack.repoId] = ordered
    }
  }
  return overrides
}
