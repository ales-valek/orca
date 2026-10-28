import { gitReadOptionsForWorktree, type GitRuntimeOptions } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

// Why: a leading dash would turn a persisted ref name into a git option.
function isSafeRefArgument(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith('-')
}

/** Commit a local branch points at, or null when the branch does not exist. */
export async function getBranchTip(
  repoPath: string,
  branch: string,
  options: GitRuntimeOptions = {}
): Promise<string | null> {
  if (!isSafeRefArgument(branch)) {
    return null
  }
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

/** Best common ancestor of two refs, or null when either is missing or they share no history. */
export async function getMergeBase(
  repoPath: string,
  left: string,
  right: string,
  options: GitRuntimeOptions = {}
): Promise<string | null> {
  if (!isSafeRefArgument(left) || !isSafeRefArgument(right)) {
    return null
  }
  try {
    const { stdout } = await gitExecFileAsync(
      ['merge-base', left, right],
      gitReadOptionsForWorktree(repoPath, options)
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}
