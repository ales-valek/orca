import { getRepoTaskStack } from '../../shared/mission-task-stack'
import type { Mission, MissionTask } from '../../shared/mission-types'

/** The ref a person types for a task: its tracker key, else its branch name. */
export function getMissionTaskDisplayRef(task: Pick<MissionTask, 'externalRef' | 'branchName'>) {
  return task.externalRef || task.branchName
}

/** Every ref that selects a task: tracker key, branch name, or id. */
export function getMissionTaskRefs(
  task: Pick<MissionTask, 'id' | 'externalRef' | 'branchName'>
): string[] {
  return [...(task.externalRef ? [task.externalRef] : []), task.branchName, task.id]
}

export function findMissionTaskIdByRef(
  mission: Pick<Mission, 'tasks'>,
  repoId: string,
  ref: string
): string | null {
  const task = getRepoTaskStack(mission, repoId).find((candidate) =>
    getMissionTaskRefs(candidate).includes(ref)
  )
  return task?.id ?? null
}
