import type { MissionEvent } from '../../shared/huly/huly-status-rules'
import { getRepoTaskStack } from '../../shared/mission-task-stack'
import type {
  Mission,
  MissionStackPullRequestsResult,
  MissionTaskResult
} from '../../shared/mission-types'
import type { Store } from '../persistence'
import type { MissionPullRequestMerge } from './mission-stack-merge-notification'

export type MissionEventListener = (event: MissionEvent) => unknown

/** Task layers of `repoId` that just got a new PR; the mission-branch PR is not a task. */
export function getStackPrCreatedTaskIds(
  mission: Mission,
  repoId: string,
  created: readonly { branch: string }[]
): string[] {
  const branches = new Set(created.map((entry) => entry.branch))
  return getRepoTaskStack(mission, repoId)
    .filter((task) => branches.has(task.branchName))
    .map((task) => task.id)
}

/** The merged head layer plus the layers below it that the same stack merge took along. */
export function getMergedMissionEvents(
  missions: readonly Mission[],
  getRepoPath: (repoId: string) => string | null,
  merge: MissionPullRequestMerge
): MissionEvent[] {
  return missions.flatMap((mission) => {
    const head = (mission.tasks ?? []).find(
      (task) => task.branchName === merge.headBranch && getRepoPath(task.repoId) === merge.repoPath
    )
    if (!head) {
      return []
    }
    const lowestOrder = head.order - Math.max(1, merge.mergedCount) + 1
    const taskIds = getRepoTaskStack(mission, head.repoId)
      .filter((task) => task.order >= lowestOrder && task.order <= head.order)
      .map((task) => task.id)
    return [{ kind: 'stack-merged' as const, missionId: mission.id, taskIds }]
  })
}

/** Fire-and-forget: a listener failure never reaches the Mission operation. */
export function emitMissionEvent(
  listener: MissionEventListener | undefined,
  event: MissionEvent
): void {
  if (!listener || event.taskIds.length === 0) {
    return
  }
  const logFailure = (error: unknown) => {
    console.error('[missions] mission event listener failed:', error)
  }
  try {
    void Promise.resolve(listener(event)).catch(logFailure)
  } catch (error) {
    logFailure(error)
  }
}

/** Turns finished Mission operations into events for the listener; never fails the operation. */
export class MissionEventReporter {
  constructor(
    private readonly store: Pick<Store, 'getMission' | 'getMissions' | 'getRepo'>,
    private readonly listener: MissionEventListener | undefined
  ) {}

  taskAdded(missionId: string, result: MissionTaskResult): MissionTaskResult {
    if (result.task && !result.error) {
      emitMissionEvent(this.listener, {
        kind: 'layer-created',
        missionId,
        taskIds: [result.task.id]
      })
    }
    return result
  }

  stackPullRequestsCreated(
    args: { missionId: string; repoId: string },
    result: MissionStackPullRequestsResult
  ): MissionStackPullRequestsResult {
    const mission = this.store.getMission(args.missionId)
    if (mission) {
      emitMissionEvent(this.listener, {
        kind: 'stack-pr-created',
        missionId: args.missionId,
        taskIds: getStackPrCreatedTaskIds(mission, args.repoId, result.created)
      })
    }
    return result
  }

  pullRequestMerged(merge: MissionPullRequestMerge): void {
    const getRepoPath = (repoId: string) => this.store.getRepo(repoId)?.path ?? null
    for (const event of getMergedMissionEvents(this.store.getMissions(), getRepoPath, merge)) {
      emitMissionEvent(this.listener, event)
    }
  }
}
