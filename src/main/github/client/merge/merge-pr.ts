import { invalidateReviewLookupsAfterPRMutation } from '../../pr-mutation-review-invalidation'
import type { PRConflictSummary } from '../../../../shared/github/pull-request-types'
import { getPRConflictSummary } from '../../conflict-summary'
import { ghExecFileAsync, acquire, release, type LocalGitExecOptions } from '../../gh-utils'
import { resolveGitHubRepoExecution, type GitHubApiRepository } from '../../github-api-repository'
import { mergeGitHubPRStack } from '../../github-pr-stack'
import { githubPRStackExecutionScope, type GhExecOptions } from './../github-exec-scope'
import { detectRepositoryMergeMetadata } from './../detect/repository-merge-metadata'
import type { PullRequestLookupData } from './../lookup/pull-request-lookup-data'
import { getRestPRByNumber, getPRByNumber } from './../lookup/pr-number-lookup'
import { STACK_METADATA_UNAVAILABLE_ERROR } from './../lookup/pr-stack-summary-cache'
import { notifyMissionPullRequestMerged } from '../../../missions/mission-stack-merge-notification'
export async function mergePR(
  repoPath: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
  connectionId?: string | null,
  prRepo?: GitHubApiRepository | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ownerRepo, ghOptions } = await resolveGitHubRepoExecution(
    repoPath,
    prRepo,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return { ok: false, error: 'Could not resolve GitHub owner/repo for this repository' }
  }
  await acquire()
  let concurrencySlotHeld = true
  try {
    let restData: PullRequestLookupData
    try {
      restData = await getRestPRByNumber(ownerRepo, prNumber, ghOptions, {
        requireUsableStackMetadata: true
      })
    } catch (err) {
      const diagnostic =
        err instanceof SyntaxError
          ? 'invalid JSON response'
          : err instanceof Error
            ? err.message
            : String(err)
      console.warn(
        `mergePR stack metadata probe failed for ${ownerRepo.owner}/${ownerRepo.repo}#${String(prNumber)}:`,
        diagnostic
      )
      return { ok: false, error: STACK_METADATA_UNAVAILABLE_ERROR }
    }
    if (restData.stack) {
      const mergeMetadata = await detectRepositoryMergeMetadata(
        ownerRepo,
        restData.stack.baseRefName,
        ghOptions,
        githubPRStackExecutionScope(connectionId, localGitOptions)
      )
      release()
      concurrencySlotHeld = false
      const mergeAction = mergeMetadata.mergeQueueRequired === true ? 'merge_queue' : 'direct_merge'
      const result = await mergeGitHubPRStack({
        repository: ownerRepo,
        prNumber,
        method,
        mergeAction,
        headSha: restData.headRefOid,
        ghOptions
      })
      if (result.ok) {
        invalidateReviewLookupsAfterPRMutation(repoPath, connectionId)
        // Why: an enqueued stack is not merged yet; GitHub merges every PR below this one with it.
        if (mergeAction === 'direct_merge' && restData.headRefName) {
          notifyMissionPullRequestMerged({
            repoPath,
            headBranch: restData.headRefName,
            baseBranch: restData.stack.baseRefName,
            mergedCount: restData.stack.position,
            ...(restData.headRefOid ? { headSha: restData.headRefOid } : {})
          })
        }
      }
      return result
    }
    const mergeBlocker = await getPRMergeBlocker(
      repoPath,
      prNumber,
      ownerRepo,
      ghOptions,
      connectionId,
      localGitOptions
    )
    if (mergeBlocker) {
      return { ok: false, error: mergeBlocker }
    }

    // Deleting the local branch fails while its worktree still has it checked out.
    const args = ['pr', 'merge', String(prNumber), `--${method}`]
    if (ownerRepo) {
      args.push('--repo', `${ownerRepo.owner}/${ownerRepo.repo}`)
    }
    await ghExecFileAsync(args, {
      ...ghOptions,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' }
    })
    invalidateReviewLookupsAfterPRMutation(repoPath, connectionId)
    if (restData.headRefName && restData.baseRefName) {
      notifyMissionPullRequestMerged({
        repoPath,
        headBranch: restData.headRefName,
        baseBranch: restData.baseRefName,
        mergedCount: 1,
        ...(restData.headRefOid ? { headSha: restData.headRefOid } : {})
      })
    }
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
    return { ok: false, error: message }
  } finally {
    if (concurrencySlotHeld) {
      release()
    }
  }
}

export async function getPRMergeBlocker(
  repoPath: string,
  prNumber: number,
  ownerRepo: GitHubApiRepository | null,
  ghOptions: GhExecOptions,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<string | null> {
  if (!ownerRepo) {
    return null
  }

  try {
    const pr = await getPRByNumber(
      ownerRepo,
      prNumber,
      ghOptions,
      githubPRStackExecutionScope(connectionId, localGitOptions)
    )
    if (!pr) {
      return null
    }
    if (pr.reviewDecision === 'REVIEW_REQUIRED') {
      return 'This pull request requires review approval before it can be merged.'
    }
    if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      return 'This pull request has requested changes and cannot be merged yet.'
    }
    if (pr.mergeQueueRequired === true) {
      return 'This pull request must be merged through GitHub merge queue. Use Merge when ready instead.'
    }
    // Conflict derivation uses local Git and cannot inspect SSH-backed repositories.
    if (
      connectionId ||
      pr.mergeable !== 'CONFLICTING' ||
      !pr.baseRefName ||
      !pr.baseRefOid ||
      !pr.headRefOid
    ) {
      return null
    }

    const summary = await getPRConflictSummary(
      repoPath,
      pr.baseRefName,
      pr.baseRefOid,
      pr.headRefOid,
      localGitOptions
    )
    return formatMergeConflictBlocker(pr.baseRefName, summary)
  } catch {
    // Advisory conflict diagnostics must not block merging on transient failures.
    return null
  }
}

export function formatMergeConflictBlocker(
  baseRefName: string,
  summary: PRConflictSummary | undefined
): string {
  const heading = 'This pull request has merge conflicts and cannot be merged yet.'
  if (!summary || summary.files.length === 0) {
    return `${heading}\nUpdate the branch with ${baseRefName} and resolve the conflicts before merging.`
  }

  const files = summary.files.map((file) => `- ${file}`).join('\n')
  const behind = `${summary.commitsBehind} commit${summary.commitsBehind === 1 ? '' : 's'} behind ${baseRefName}`
  return `${heading}\n${behind} (base commit: ${summary.baseCommit}).\n\nConflicting files:\n${files}`
}
