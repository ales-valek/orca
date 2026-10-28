import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type {
  CreateHostedReviewResult,
  CreateStackedHostedReviewResult,
  HostedReviewProvider
} from '../../shared/hosted-review'
import { deriveMissionLayerState } from '../../shared/mission-layer-state'
import { getMissionTaskParentBranch, getRepoTaskStack } from '../../shared/mission-task-stack'
import type { Mission, MissionTask } from '../../shared/mission-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { getBranchTip } from '../git/stack-layer-git'
import type { createStackedHostedReview } from '../source-control/stacked-hosted-review-creation'
import type { createHostedReview } from '../source-control/hosted-review-creation'

export type MissionStackPullRequestDeps = {
  createHostedReview: typeof createHostedReview
  createStackedHostedReview: typeof createStackedHostedReview
  getBranchTip: typeof getBranchTip
  /** Default base without a remote prefix, e.g. `main`. */
  defaultBaseBranch: string
  getProvider: () => Promise<HostedReviewProvider>
  /** Commits on `branch` that the default base lacks. */
  getCommitsAheadCount: (base: string, branch: string) => Promise<number>
  /** First publication only: never overwrites a remote branch. */
  pushBranch: (branch: string) => Promise<void>
}

export type MissionStackPushDeps = {
  getBranchTip: typeof getBranchTip
  /** Last known remote tip of `branch`, or null when it was never pushed. */
  getRemoteTrackingTip: (branch: string) => Promise<string | null>
  /** Overwrites the remote branch only while it still sits at `leaseSha`. */
  pushBranch: (branch: string, leaseSha: string) => Promise<void>
}

export type MissionStackPullRequestsResult = {
  created: { branch: string; url: string }[]
  /** Layers that already had an open PR (only distinguishable on the plain-create path). */
  skipped: { branch: string; url?: string }[]
  error?: string
}

type LayerCheckout = { branch: string; path: string }

const PUSH_REJECTED_PATTERN = /rejected|non-fast-forward|fetch first|diverged/i

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function worktreePathOf(worktreeId: string | null | undefined): string | null {
  return worktreeId ? (splitWorktreeId(worktreeId)?.worktreePath ?? null) : null
}

function taskTitle(task: MissionTask): string {
  return `${task.externalRef ? `${task.externalRef}: ` : ''}${task.title}`
}

function getMemberCheckout(mission: Mission, repoId: string): LayerCheckout | null {
  const member = mission.members.find((entry) => entry.repoId === repoId)
  const path = worktreePathOf(member?.worktreeId)
  return path ? { branch: mission.branchName, path } : null
}

/** Pushes then opens a PR for each layer bottom-up; stops at the first failure. */
export async function createMissionStackPullRequests(
  args: { mission: Mission; repoId: string; draft?: boolean },
  deps: MissionStackPullRequestDeps
): Promise<MissionStackPullRequestsResult> {
  const { mission, repoId } = args
  const created: MissionStackPullRequestsResult['created'] = []
  const skipped: MissionStackPullRequestsResult['skipped'] = []
  const fail = (error: string): MissionStackPullRequestsResult => ({
    created,
    skipped,
    error
  })

  const member = getMemberCheckout(mission, repoId)
  if (!member) {
    return fail('mission_member_worktree_missing')
  }
  if ((await deps.getProvider()) !== 'github') {
    return fail('mission_stack_prs_unsupported_provider')
  }
  const base = deps.defaultBaseBranch
  let missionBranchAhead: boolean
  try {
    missionBranchAhead = (await deps.getCommitsAheadCount(base, mission.branchName)) > 0
  } catch (error) {
    return fail(toErrorMessage(error))
  }

  const layers: {
    checkout: LayerCheckout
    base: string
    title: string
    stacked: boolean
  }[] = []
  if (missionBranchAhead) {
    layers.push({
      checkout: member,
      base,
      title: mission.name,
      stacked: false
    })
  }
  for (const task of getRepoTaskStack(mission, repoId)) {
    const path = worktreePathOf(task.worktreeId)
    if (!path) {
      // Why: validate every layer before the first push so a missing checkout leaves the remote untouched.
      return fail(`mission_task_worktree_missing: ${task.branchName}`)
    }
    const parent = getMissionTaskParentBranch(mission, task)
    layers.push({
      checkout: { branch: task.branchName, path },
      base: parent === mission.branchName && !missionBranchAhead ? base : parent,
      title: taskTitle(task),
      // Why: layer 1 has no parent PR to stack under; its parent is the mission PR or the default base.
      stacked: task.order > 1
    })
  }

  for (const layer of layers) {
    const { branch, path } = layer.checkout
    try {
      await deps.pushBranch(branch)
    } catch (error) {
      const message = toErrorMessage(error)
      return fail(
        PUSH_REJECTED_PATTERN.test(message)
          ? `Layer ${branch} was rewritten; push the stack first`
          : `${branch}: ${message}`
      )
    }
    const input = {
      provider: 'github' as const,
      base: layer.base,
      head: branch,
      title: layer.title,
      draft: args.draft,
      worktreePath: path,
      useTemplate: true
    }
    let result: CreateHostedReviewResult | CreateStackedHostedReviewResult
    try {
      result = layer.stacked
        ? await deps.createStackedHostedReview(path, input, LOCAL_EXECUTION_HOST_ID)
        : await deps.createHostedReview(path, input, LOCAL_EXECUTION_HOST_ID)
    } catch (error) {
      return fail(`${branch}: ${toErrorMessage(error)}`)
    }
    if (result.ok) {
      created.push({ branch, url: result.url })
      continue
    }
    if ('existingReview' in result && result.code === 'already_exists') {
      skipped.push({ branch, url: result.existingReview?.url })
      continue
    }
    return fail(`${branch}: ${result.error}`)
  }
  return { created, skipped }
}

/** Force-with-lease push of layers that moved since their last push; explicit user action only. */
export async function pushMissionStack(
  args: { mission: Mission; repoId: string },
  deps: MissionStackPushDeps
): Promise<{ pushed: string[]; error?: string }> {
  const { mission, repoId } = args
  const pushed: string[] = []
  const member = getMemberCheckout(mission, repoId)
  if (!member) {
    return { pushed, error: 'mission_member_worktree_missing' }
  }
  const readLayer = async (
    branch: string,
    parentBranch: string | null,
    parentBaseSha: string | null
  ) => {
    const [localTip, pushedTip, parentTip] = await Promise.all([
      deps.getBranchTip(member.path, branch),
      deps.getRemoteTrackingTip(branch),
      parentBranch ? deps.getBranchTip(member.path, parentBranch) : Promise.resolve(null)
    ])
    // ponytail: a remote-tracking ref stands in for "has an open PR"; a branch pushed without a PR
    // is also treated as published, and a stale ref hides a PR closed elsewhere. Needs a PR lookup to be exact.
    const state = deriveMissionLayerState({
      parentTip,
      parentBaseSha,
      isClean: true,
      isAgentWorking: false,
      conflict: false,
      prMerged: false,
      localTip,
      pushedTip,
      hasOpenPr: pushedTip !== null
    })
    return { state, pushedTip }
  }

  try {
    const layers = [
      { branch: mission.branchName, parentBranch: null, parentBaseSha: null },
      ...getRepoTaskStack(mission, repoId).map((task) => ({
        branch: task.branchName,
        parentBranch: getMissionTaskParentBranch(mission, task),
        parentBaseSha: task.parentBaseSha
      }))
    ]
    for (const layer of layers) {
      const { state, pushedTip } = await readLayer(
        layer.branch,
        layer.parentBranch,
        layer.parentBaseSha
      )
      if (state !== 'needs-push' || !pushedTip) {
        continue
      }
      await deps.pushBranch(layer.branch, pushedTip)
      pushed.push(layer.branch)
    }
  } catch (error) {
    return { pushed, error: toErrorMessage(error) }
  }
  return { pushed }
}
