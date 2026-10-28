import type { Mission } from '../mission-types'
import type { HulyMissionPlan } from './huly-mission-plan'
import type { HulyIssue } from './huly-types'

export type HulyNonAppendableReason =
  | 'inserted-in-middle'
  | 'repo-not-in-mission'
  | 'blocked-cycle'
  | 'unmapped'
  | 'blocked-by-pending'

export type HulyMissionRefreshDiff = {
  /** New issues whose plan position is after every existing task of that repo, in plan order. */
  appendable: { repoId: string; issues: HulyIssue[] }[]
  /** Huly order vs `source.importedOrder` for issues present in both. */
  reorderedInHuly: { repoId: string; before: string[]; after: string[] }[]
  /** Identifiers of existing tasks that left the milestone or lost their repo mapping. */
  removed: string[]
  /** Identifiers of existing tasks whose issue is now skipped (Won, Lost or a skip status).
   *  Optional: older runtimes report these in `removed`. */
  completed?: string[]
  movedRepo: { identifier: string; fromRepoId: string; toRepoId: string }[]
  /** `repoId` is null for an issue whose component maps to no repo. */
  nonAppendable: {
    repoId: string | null
    identifier: string
    reason: HulyNonAppendableReason
  }[]
}

type RefreshMission = Pick<Mission, 'tasks' | 'source' | 'members'>

function isSameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function diffMissionAgainstPlan(
  mission: RefreshMission,
  plan: HulyMissionPlan
): HulyMissionRefreshDiff {
  const importedOrder = mission.source?.importedOrder ?? {}
  const memberRepoIds = new Set(mission.members.map((member) => member.repoId))
  const existingTasks = (mission.tasks ?? []).filter(
    (task): task is typeof task & { externalRef: string } => Boolean(task.externalRef)
  )
  const existingRefs = new Set(existingTasks.map((task) => task.externalRef))
  const importedRefs = new Set(Object.values(importedOrder).flat())

  const planRepoByIdentifier = new Map<string, string>()
  for (const stack of plan.stacks) {
    for (const { issue } of stack.tasks) {
      planRepoByIdentifier.set(issue.identifier, stack.repoId)
    }
  }
  const cycleRepoByIdentifier = new Map<string, string>()
  for (const cycle of plan.cycles) {
    for (const identifier of cycle.identifiers) {
      cycleRepoByIdentifier.set(identifier, cycle.repoId)
    }
  }

  const skippedRefs = new Set(plan.skipped.map((issue) => issue.identifier))
  const removed: string[] = []
  const completed: string[] = []
  const movedRepo: HulyMissionRefreshDiff['movedRepo'] = []
  for (const task of existingTasks) {
    const toRepoId = planRepoByIdentifier.get(task.externalRef)
    const cycleRepoId = cycleRepoByIdentifier.get(task.externalRef)
    if (toRepoId === undefined && cycleRepoId === undefined) {
      ;(skippedRefs.has(task.externalRef) ? completed : removed).push(task.externalRef)
    } else if ((toRepoId ?? cycleRepoId) !== task.repoId) {
      movedRepo.push({
        identifier: task.externalRef,
        fromRepoId: task.repoId,
        toRepoId: toRepoId ?? cycleRepoId ?? task.repoId
      })
    }
  }

  const appendable: HulyMissionRefreshDiff['appendable'] = []
  const nonAppendable: HulyMissionRefreshDiff['nonAppendable'] = []
  const reorderedInHuly: HulyMissionRefreshDiff['reorderedInHuly'] = []
  for (const stack of plan.stacks) {
    const identifiers = stack.tasks.map(({ issue }) => issue.identifier)
    // Why: ids still in importedOrder anchor even after their task was removed, keeping appended ids in plan order.
    const lastAnchorIndex = Math.max(
      -1,
      ...identifiers.flatMap((identifier, index) =>
        existingRefs.has(identifier) || importedRefs.has(identifier) ? [index] : []
      )
    )
    const issues: HulyIssue[] = []
    for (const [index, { issue }] of stack.tasks.entries()) {
      const { identifier } = issue
      if (existingRefs.has(identifier) || importedRefs.has(identifier)) {
        continue
      }
      if (!memberRepoIds.has(stack.repoId)) {
        nonAppendable.push({ repoId: stack.repoId, identifier, reason: 'repo-not-in-mission' })
      } else if (index > lastAnchorIndex) {
        issues.push(issue)
      } else {
        nonAppendable.push({ repoId: stack.repoId, identifier, reason: 'inserted-in-middle' })
      }
    }
    if (issues.length > 0) {
      appendable.push({ repoId: stack.repoId, issues })
    }

    const before = (importedOrder[stack.repoId] ?? []).filter(
      (identifier) => planRepoByIdentifier.get(identifier) === stack.repoId
    )
    const beforeSet = new Set(before)
    const after = identifiers.filter((identifier) => beforeSet.has(identifier))
    if (!isSameSequence(before, after)) {
      reorderedInHuly.push({ repoId: stack.repoId, before, after })
    }
  }
  for (const cycle of plan.cycles) {
    for (const identifier of cycle.identifiers) {
      if (!existingRefs.has(identifier) && !importedRefs.has(identifier)) {
        nonAppendable.push({ repoId: cycle.repoId, identifier, reason: 'blocked-cycle' })
      }
    }
  }

  for (const issue of plan.unmapped) {
    if (!existingRefs.has(issue.identifier) && !importedRefs.has(issue.identifier)) {
      nonAppendable.push({ repoId: null, identifier: issue.identifier, reason: 'unmapped' })
    }
  }

  demoteBlockedAppendable(appendable, nonAppendable)
  return { appendable, reorderedInHuly, removed, completed, movedRepo, nonAppendable }
}

// Why: appending an issue whose blocker cannot be added would skip the blocker in the dependency order.
function demoteBlockedAppendable(
  appendable: HulyMissionRefreshDiff['appendable'],
  nonAppendable: HulyMissionRefreshDiff['nonAppendable']
): void {
  const pending = new Set(nonAppendable.map((entry) => entry.identifier))
  let changed = true
  while (changed) {
    changed = false
    for (const entry of appendable) {
      const kept = entry.issues.filter((issue) => {
        if (!issue.blockedBy.some((blocker) => pending.has(blocker))) {
          return true
        }
        pending.add(issue.identifier)
        nonAppendable.push({
          repoId: entry.repoId,
          identifier: issue.identifier,
          reason: 'blocked-by-pending'
        })
        changed = true
        return false
      })
      entry.issues = kept
    }
  }
  appendable.splice(0, appendable.length, ...appendable.filter((entry) => entry.issues.length > 0))
}

/** Inserts each appended id after the last recorded id that precedes it in the plan. */
export function insertAppendedIntoImportedOrder(
  order: string[],
  appended: string[],
  planIdentifiers: string[]
): string[] {
  const planIndex = new Map(planIdentifiers.map((identifier, index) => [identifier, index]))
  const result = [...order]
  for (const identifier of appended) {
    const position = planIndex.get(identifier) ?? Infinity
    const after = result.findLastIndex((entry) => (planIndex.get(entry) ?? Infinity) < position)
    result.splice(after + 1, 0, identifier)
  }
  return result
}
