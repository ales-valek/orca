import { gitReadOptionsForWorktree, type GitRuntimeOptions } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

/** Commit a local branch points at, or null when the branch does not exist. */
export async function getBranchTip(
  repoPath: string,
  branch: string,
  options: GitRuntimeOptions = {}
): Promise<string | null> {
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`],
      gitReadOptionsForWorktree(repoPath, options)
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Best common ancestor of two local branches, or null when either is missing or they share no history. */
export async function getMergeBase(
  repoPath: string,
  left: string,
  right: string,
  options: GitRuntimeOptions = {}
): Promise<string | null> {
  try {
    const { stdout } = await gitExecFileAsync(
      ['merge-base', `refs/heads/${left}`, `refs/heads/${right}`],
      gitReadOptionsForWorktree(repoPath, options)
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}
