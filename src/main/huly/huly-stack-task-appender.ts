import type { HulyMissionPlan } from '../../shared/huly/huly-mission-plan'
import type { MissionTaskResult } from '../../shared/mission-types'
import type { MissionAddTaskInput } from '../missions/mission-task-operations'

export type HulyAddTask = (args: MissionAddTaskInput) => Promise<MissionTaskResult>

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Stops a repo at its first failed layer: stacking later issues on top would misorder it. */
export async function appendStackTasks(
  addTask: HulyAddTask,
  missionId: string,
  stack: HulyMissionPlan['stacks'][number],
  taskResults: MissionTaskResult[]
): Promise<{ warnings: string[]; appended: string[] }> {
  const warnings: string[] = []
  const appended: string[] = []
  for (const [index, { issue }] of stack.tasks.entries()) {
    let failure: string | null = null
    try {
      const result = await addTask({
        missionId,
        repoId: stack.repoId,
        title: issue.title,
        externalRef: issue.identifier,
        externalId: issue.id
      })
      taskResults.push(result)
      if (result.warning) {
        warnings.push(`${issue.identifier}: ${result.warning}`)
      }
      failure = result.error ?? null
    } catch (error) {
      failure = toErrorMessage(error)
    }
    if (failure !== null) {
      const skipped = stack.tasks.slice(index + 1).map((task) => task.issue.identifier)
      const notAdded = skipped.length > 0 ? `; not added: ${skipped.join(', ')}` : ''
      warnings.push(`${issue.identifier}: ${failure}${notAdded}`)
      break
    }
    appended.push(issue.identifier)
  }
  return { warnings, appended }
}
