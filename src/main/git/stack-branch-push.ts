import { normalizeGitErrorMessage } from '../../shared/git/remotes/git-remote-error'
import { isSafeGitRefName } from '../../shared/git/status/git-status-upstream-ref'
import { gitReadOptionsForWorktree, gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

async function revParse(repoPath: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      gitReadOptionsForWorktree(repoPath, {})
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Last fetched or pushed tip of a branch on `remote`, or null when it was never pushed. */
export function getRemoteTrackingTip(
  repoPath: string,
  remote: string,
  branch: string
): Promise<string | null> {
  return revParse(repoPath, `refs/remotes/${remote}/${branch}`)
}

/** Pushes one local branch; with `leaseSha` it only overwrites a remote branch still at that commit. Never forces without a lease. */
export async function pushStackBranch(
  repoPath: string,
  remote: string,
  branch: string,
  leaseSha?: string
): Promise<void> {
  if (
    !isSafeGitRefName(`refs/heads/${branch}`) ||
    remote.startsWith('-') ||
    (leaseSha !== undefined && !/^[0-9a-f]{40,64}$/.test(leaseSha))
  ) {
    throw new Error(`Refusing to push unsafe ref name: ${branch}`)
  }
  try {
    await gitExecFileAsync(
      [
        'push',
        ...(leaseSha ? [`--force-with-lease=refs/heads/${branch}:${leaseSha}`] : []),
        '--set-upstream',
        remote,
        `refs/heads/${branch}:refs/heads/${branch}`
      ],
      gitOptionsForWorktree(repoPath, {})
    )
  } catch (error) {
    throw new Error(normalizeGitErrorMessage(error, 'push'))
  }
}

/** Commits on `branch` that the base lacks; compares against the remote-tracking base when it exists. */
export async function getCommitsAheadCount(
  repoPath: string,
  remote: string,
  base: string,
  branch: string
): Promise<number> {
  const baseRef =
    (await revParse(repoPath, `refs/remotes/${remote}/${base}`)) === null
      ? `refs/heads/${base}`
      : `refs/remotes/${remote}/${base}`
  if ((await revParse(repoPath, baseRef)) === null) {
    throw new Error(`Base branch ${base} was not found locally.`)
  }
  const { stdout } = await gitExecFileAsync(
    ['rev-list', '--count', `${baseRef}..refs/heads/${branch}`],
    gitReadOptionsForWorktree(repoPath, {})
  )
  return Number.parseInt(stdout.trim(), 10) || 0
}
