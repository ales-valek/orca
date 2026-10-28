/** `headBranch`'s PR and the `mergedCount - 1` PRs stacked below it were merged by Orca into `baseBranch`. */
export type MissionPullRequestMerge = {
  repoPath: string
  headBranch: string
  baseBranch: string
  mergedCount: number
  /** Head commit of the merged PR; without it a mission-branch merge reports no layer. */
  headSha?: string
}

type PullRequestMergedListener = (merge: MissionPullRequestMerge) => void

let listener: PullRequestMergedListener | null = null

/** Mission operations register here so GitHub merge code need not know about Missions. */
export function setMissionPullRequestMergedListener(next: PullRequestMergedListener | null): void {
  listener = next
}

/** Call after Orca merged a PR (or a PR stack); never throws into the merge. */
export function notifyMissionPullRequestMerged(merge: MissionPullRequestMerge): void {
  try {
    listener?.(merge)
  } catch (error) {
    console.error('[missions] merge notification failed:', error)
  }
}
