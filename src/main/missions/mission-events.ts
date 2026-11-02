import { normalizeHostedReviewBaseRef } from '../../shared/hosted-review-refs'
import type { MissionEvent } from '../../shared/huly/huly-status-rules'
import { getRepoTaskStack } from '../../shared/mission-task-stack'
import type {
  Mission,
  MissionStackPullRequestsResult,
  MissionTaskResult
} from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import { getBranchTip, isAncestorCommit } from '../git/stack-layer-git'
import type { Store } from '../persistence/loading-store/store'
import type { MissionPullRequestMerge } from './mission-stack-merge-notification'
import { resolveLocalMissionDefaultBaseBranch } from './mission-stack-pull-request-git'

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

/** `viaMissionBranch`: the layers still need an ancestry check against the merged head. */
export type MissionMergeCandidate = {
  repoId: string
  event: MissionEvent
  viaMissionBranch: boolean
}

export type MissionEventGit = {
  getDefaultBaseBranch: (repo: Repo) => Promise<string>
  /** True only when git proved `branch`'s local tip is an ancestor of `headSha`. */
  isBranchContainedIn: (repo: Repo, branch: string, headSha: string) => Promise<boolean>
}

const LOCAL_MISSION_EVENT_GIT: MissionEventGit = {
  getDefaultBaseBranch: resolveLocalMissionDefaultBaseBranch,
  isBranchContainedIn: async (repo, branch, headSha) => {
    const tip = await getBranchTip(repo.path, branch)
    return tip !== null && (await isAncestorCommit(repo.path, tip, headSha))
  }
}

/** Layers a merge may have taken along, before checking its base: a merged task layer plus the
 *  layers below it, or every layer of the repo when the mission branch itself was merged. */
export function getMissionMergeCandidates(
  missions: readonly Mission[],
  getRepoPath: (repoId: string) => string | null,
  merge: MissionPullRequestMerge
): MissionMergeCandidate[] {
  const toCandidate = (
    mission: Mission,
    repoId: string,
    taskIds: string[],
    viaMissionBranch = false
  ) => ({
    repoId,
    event: { kind: 'stack-merged' as const, missionId: mission.id, taskIds },
    viaMissionBranch
  })
  return missions.flatMap((mission) => {
    if (mission.branchName === merge.headBranch) {
      return mission.members
        .filter((member) => getRepoPath(member.repoId) === merge.repoPath)
        .map((member) =>
          toCandidate(
            mission,
            member.repoId,
            getRepoTaskStack(mission, member.repoId).map((task) => task.id),
            true
          )
        )
    }
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
    return [toCandidate(mission, head.repoId, taskIds)]
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
    private readonly listener: MissionEventListener | undefined,
    private readonly git: MissionEventGit = LOCAL_MISSION_EVENT_GIT
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

  /** Only a merge into the repo's default base counts; resolves after the events were emitted. */
  async pullRequestMerged(merge: MissionPullRequestMerge): Promise<void> {
    const getRepoPath = (repoId: string) => this.store.getRepo(repoId)?.path ?? null
    const candidates = getMissionMergeCandidates(this.store.getMissions(), getRepoPath, merge)
    const defaultBases = new Map<string, Promise<string | null>>()
    for (const { repoId, event, viaMissionBranch } of candidates) {
      const repo = this.store.getRepo(repoId)
      if (!repo) {
        continue
      }
      if (!defaultBases.has(repoId)) {
        defaultBases.set(
          repoId,
          this.git.getDefaultBaseBranch(repo).catch((error: unknown) => {
            console.error('[missions] could not resolve the default base branch:', error)
            return null
          })
        )
      }
      if ((await defaultBases.get(repoId)) !== normalizeHostedReviewBaseRef(merge.baseBranch)) {
        continue
      }
      const taskIds = viaMissionBranch
        ? await this.getTaskIdsContainedIn(repo, event, merge.headSha)
        : event.taskIds
      emitMissionEvent(this.listener, { ...event, taskIds })
    }
  }

  // Why: a mission-branch merge carries only the layers already merged into it; unproven ones stay put.
  private async getTaskIdsContainedIn(
    repo: Repo,
    event: MissionEvent,
    headSha: string | undefined
  ): Promise<string[]> {
    const mission = this.store.getMission(event.missionId)
    if (!headSha || !mission) {
      return []
    }
    const contained = await Promise.all(
      event.taskIds.map(async (taskId) => {
        const branch = mission.tasks?.find((task) => task.id === taskId)?.branchName
        if (!branch) {
          return false
        }
        return this.git.isBranchContainedIn(repo, branch, headSha).catch((error: unknown) => {
          console.error('[missions] could not verify a merged layer:', error)
          return false
        })
      })
    )
    return event.taskIds.filter((_taskId, index) => contained[index])
  }
}
