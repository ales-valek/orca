import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { normalizeHostedReviewBaseRef } from '../../shared/hosted-review-refs'
import type { Repo } from '../../shared/repo-types'
import { getDefaultRemote, resolveDefaultBaseRefWithLocalGit } from '../git/repo'
import {
  getCommitsAheadCount,
  getRemoteTrackingTip,
  pushStackBranch
} from '../git/stack-branch-push'
import { getBranchTip } from '../git/stack-layer-git'
import { hasWorktreeBaseCommitRef } from '../git/worktree-base-ref-probe'
import { createHostedReview } from '../source-control/hosted-review-creation'
import { detectHostedReviewProvider } from '../source-control/forge-provider'
import { createStackedHostedReview } from '../source-control/stacked-hosted-review-creation'
import { resolveWorktreeCreateBase } from '../worktree-create-base'
import type { LayerPushTips } from './mission-stack-inspection'
import type {
  MissionStackPullRequestDeps,
  MissionStackPushDeps
} from './mission-stack-pull-requests'

/** The branch worktree creation would base on, without its remote prefix (`origin/main` -> `main`). */
async function getDefaultBaseBranch(repo: Repo, remote: string): Promise<string> {
  const ref = await resolveWorktreeCreateBase({
    repoWorktreeBaseRef: repo.worktreeBaseRef,
    resolveDefaultBaseRef: () => resolveDefaultBaseRefWithLocalGit({ cwd: repo.path }),
    isBaseUsable: (candidate) => hasWorktreeBaseCommitRef(repo.path, candidate)
  })
  if (!ref) {
    throw new Error('Could not resolve a default base branch for this repo.')
  }
  const withoutRemote = ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref
  return normalizeHostedReviewBaseRef(withoutRemote)
}

/** Real git and GitHub wiring; `memberPath` is the mission branch checkout, shared refs serve every layer. */
export async function createLocalMissionStackPullRequestDeps(
  repo: Repo,
  memberPath: string
): Promise<MissionStackPullRequestDeps> {
  const remote = await getDefaultRemote(repo.path)
  return {
    createHostedReview,
    createStackedHostedReview,
    getBranchTip,
    defaultBaseBranch: await getDefaultBaseBranch(repo, remote),
    getProvider: () =>
      detectHostedReviewProvider({
        repoPath: memberPath,
        executionHostId: LOCAL_EXECUTION_HOST_ID
      }),
    getCommitsAheadCount: (base, branch) => getCommitsAheadCount(repo.path, remote, base, branch),
    pushBranch: (branch) => pushStackBranch(repo.path, remote, branch)
  }
}

export async function createLocalMissionStackPushDeps(repo: Repo): Promise<MissionStackPushDeps> {
  const remote = await getDefaultRemote(repo.path)
  return {
    getBranchTip,
    getRemoteTrackingTip: (branch) => getRemoteTrackingTip(repo.path, remote, branch),
    pushBranch: (branch, leaseSha) => pushStackBranch(repo.path, remote, branch, leaseSha)
  }
}

/** Reads each branch's local and remote-tracking tip from the repo's default remote. */
export async function readLocalMissionPushTips(
  repo: Repo,
  branches: readonly string[]
): Promise<Map<string, LayerPushTips>> {
  const remote = await getDefaultRemote(repo.path)
  const entries = await Promise.all(
    branches.map(async (branch): Promise<[string, LayerPushTips]> => {
      const [localTip, pushedTip] = await Promise.all([
        getBranchTip(repo.path, branch),
        getRemoteTrackingTip(repo.path, remote, branch)
      ])
      return [branch, { localTip, pushedTip }]
    })
  )
  return new Map(entries)
}
