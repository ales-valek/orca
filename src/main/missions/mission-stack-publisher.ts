import type { Mission } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence'
import type { MissionMemberLifecycle } from './mission-member-lifecycle'
import { requireNativeLocalMissionRepos } from './mission-repo-eligibility'
import {
  createLocalMissionStackPullRequestDeps,
  createLocalMissionStackPushDeps
} from './mission-stack-pull-request-git'
import {
  createMissionStackPullRequests,
  pushMissionStack,
  type MissionStackPullRequestsResult
} from './mission-stack-pull-requests'

type PushStackResult = { pushed: string[]; error?: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Publishes a repo's task stack to the remote; runs under the Mission run lock. */
export class MissionStackPublisher {
  constructor(
    private readonly store: Store,
    private readonly lifecycle: Pick<MissionMemberLifecycle, 'run'>
  ) {}

  createStackPullRequests(args: {
    missionId: string
    repoId: string
    draft?: boolean
  }): Promise<MissionStackPullRequestsResult> {
    return this.runOnMemberRepo(
      args,
      (error) => ({ created: [], skipped: [], error }),
      async (mission, repo, memberPath) =>
        createMissionStackPullRequests(
          { mission, repoId: args.repoId, draft: args.draft },
          await createLocalMissionStackPullRequestDeps(repo, memberPath)
        )
    )
  }

  pushStack(args: { missionId: string; repoId: string }): Promise<PushStackResult> {
    return this.runOnMemberRepo(
      args,
      (error) => ({ pushed: [], error }),
      async (mission, repo) =>
        pushMissionStack(
          { mission, repoId: args.repoId },
          await createLocalMissionStackPushDeps(repo)
        )
    )
  }

  private runOnMemberRepo<T>(
    args: { missionId: string; repoId: string },
    toFailure: (error: string) => T,
    run: (mission: Mission, repo: Repo, memberPath: string) => Promise<T>
  ): Promise<T> {
    return this.lifecycle.run(args.missionId, async () => {
      const mission = this.store.getMission(args.missionId)
      const member = mission?.members.find((entry) => entry.repoId === args.repoId)
      if (!mission) {
        return toFailure('mission_not_found')
      }
      if (!member) {
        return toFailure('mission_member_not_found')
      }
      try {
        requireNativeLocalMissionRepos(this.store, [args.repoId])
      } catch (error) {
        return toFailure(toErrorMessage(error))
      }
      const repo = this.store.getRepo(args.repoId)
      const memberPath = member.worktreeId ? splitWorktreeId(member.worktreeId)?.worktreePath : null
      if (!repo || !memberPath) {
        return toFailure('mission_member_worktree_missing')
      }
      try {
        return await run(mission, repo, memberPath)
      } catch (error) {
        return toFailure(toErrorMessage(error))
      }
    })
  }
}
