import type { HulyProjectSettings } from './huly-project-settings'
import type { HulyIssue } from './huly-types'

export type HulyPlannedTask = { issue: HulyIssue; repoId: string }

export type HulyMissionPlan = {
  /** Stacks sorted by repoId; tasks in stack order. */
  stacks: { repoId: string; tasks: HulyPlannedTask[] }[]
  unmapped: HulyIssue[]
  skipped: HulyIssue[]
  /** Identifiers left over by the topological sort; the repo is excluded from `stacks`. */
  cycles: { repoId: string; identifiers: string[] }[]
  /** `from` is the blocked issue's identifier, `to` is the blocker's identifier. */
  crossRepoDependencies: { from: string; to: string }[]
}

export type HulyMissionPlanInput = {
  issues: HulyIssue[]
  settings: HulyProjectSettings
  repoOverrides?: Record<string, string>
  orderOverrides?: Record<string, string[]>
}

function byNumber(a: HulyIssue, b: HulyIssue): number {
  return a.number - b.number
}

function isSkipped(issue: HulyIssue, settings: HulyProjectSettings): boolean {
  const statusName = issue.status.name.toLocaleLowerCase()
  return (
    issue.status.category === 'Won' ||
    issue.status.category === 'Lost' ||
    // Huly treats status names as case-insensitive.
    settings.skipStatusNames.some((name) => name.toLocaleLowerCase() === statusName)
  )
}

function isPermutation(candidate: string[], tasks: HulyPlannedTask[]): boolean {
  const expected = new Set(tasks.map((task) => task.issue.identifier))
  return (
    candidate.length === tasks.length &&
    new Set(candidate).size === tasks.length &&
    candidate.every((identifier) => expected.has(identifier))
  )
}

// Kahn's algorithm with a number-ordered ready queue; leftovers are the cycle.
function orderRepoTasks(tasks: HulyPlannedTask[]): {
  ordered: HulyPlannedTask[]
  leftover: HulyPlannedTask[]
} {
  const byIdentifier = new Map(tasks.map((task) => [task.issue.identifier, task]))
  const remaining = new Map<string, Set<string>>()
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    const blockers = new Set(task.issue.blockedBy.filter((id) => byIdentifier.has(id)))
    blockers.delete(task.issue.identifier)
    remaining.set(task.issue.identifier, blockers)
    for (const blocker of blockers) {
      dependents.set(blocker, [...(dependents.get(blocker) ?? []), task.issue.identifier])
    }
  }

  const ordered: HulyPlannedTask[] = []
  const ready = tasks.filter((task) => remaining.get(task.issue.identifier)?.size === 0)
  while (ready.length > 0) {
    ready.sort((a, b) => byNumber(a.issue, b.issue))
    const next = ready.shift()
    if (!next) {
      break
    }
    ordered.push(next)
    remaining.delete(next.issue.identifier)
    for (const dependent of dependents.get(next.issue.identifier) ?? []) {
      const blockers = remaining.get(dependent)
      blockers?.delete(next.issue.identifier)
      const task = byIdentifier.get(dependent)
      if (task && blockers?.size === 0) {
        ready.push(task)
      }
    }
  }
  const leftover = tasks.filter((task) => remaining.has(task.issue.identifier))
  return { ordered, leftover }
}

export function buildMissionPlanFromMilestone(input: HulyMissionPlanInput): HulyMissionPlan {
  const { settings, repoOverrides = {}, orderOverrides = {} } = input
  const topLevel = input.issues.filter((issue) => issue.parentIssueId === null).sort(byNumber)

  const skipped: HulyIssue[] = []
  const unmapped: HulyIssue[] = []
  const tasksByRepo = new Map<string, HulyPlannedTask[]>()
  const repoByIdentifier = new Map<string, string>()
  for (const issue of topLevel) {
    if (isSkipped(issue, settings)) {
      skipped.push(issue)
      continue
    }
    const repoId =
      repoOverrides[issue.identifier] ??
      (issue.componentId === null ? undefined : settings.componentRepoMap[issue.componentId])
    if (!repoId) {
      unmapped.push(issue)
      continue
    }
    repoByIdentifier.set(issue.identifier, repoId)
    tasksByRepo.set(repoId, [...(tasksByRepo.get(repoId) ?? []), { issue, repoId }])
  }

  const crossRepoDependencies: { from: string; to: string }[] = []
  for (const issue of topLevel) {
    const repoId = repoByIdentifier.get(issue.identifier)
    for (const blocker of new Set(issue.blockedBy)) {
      const blockerRepo = repoByIdentifier.get(blocker)
      if (repoId && blockerRepo && blockerRepo !== repoId) {
        crossRepoDependencies.push({ from: issue.identifier, to: blocker })
      }
    }
  }

  const stacks: HulyMissionPlan['stacks'] = []
  const cycles: HulyMissionPlan['cycles'] = []
  for (const repoId of [...tasksByRepo.keys()].sort()) {
    const tasks = tasksByRepo.get(repoId) ?? []
    const { ordered, leftover } = orderRepoTasks(tasks)
    if (leftover.length > 0) {
      cycles.push({ repoId, identifiers: leftover.map((task) => task.issue.identifier) })
      continue
    }
    const override = orderOverrides[repoId]
    if (override && isPermutation(override, tasks)) {
      const byIdentifier = new Map(tasks.map((task) => [task.issue.identifier, task]))
      stacks.push({
        repoId,
        tasks: override.flatMap((identifier) => byIdentifier.get(identifier) ?? [])
      })
      continue
    }
    stacks.push({ repoId, tasks: ordered })
  }

  return { stacks, unmapped, skipped, cycles, crossRepoDependencies }
}
