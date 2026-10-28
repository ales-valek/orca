import type { HulyMissionPlan, HulyPlannedTask } from '../../../../shared/huly/huly-mission-plan'

function isPermutationOf(order: readonly string[], tasks: readonly HulyPlannedTask[]): boolean {
  const identifiers = new Set(tasks.map((task) => task.issue.identifier))
  return (
    order.length === tasks.length &&
    new Set(order).size === order.length &&
    order.every((identifier) => identifiers.has(identifier))
  )
}

/** The user's order while it still covers exactly the stack's tasks, otherwise Huly's order. */
export function getOrderedStackTasks(
  tasks: readonly HulyPlannedTask[],
  order: readonly string[] | undefined
): HulyPlannedTask[] {
  if (!order || !isPermutationOf(order, tasks)) {
    return [...tasks]
  }
  const byIdentifier = new Map(tasks.map((task) => [task.issue.identifier, task]))
  return order.flatMap((identifier) => byIdentifier.get(identifier) ?? [])
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
