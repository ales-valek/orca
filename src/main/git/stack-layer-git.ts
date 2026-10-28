import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'
import {
  gitOptionsForWorktree,
  gitReadOptionsForWorktree,
  type GitRuntimeOptions
} from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { detectConflictOperation } from './source-control/git-conflict-operation'
import { runWithGitReadCacheInvalidation } from './status'

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

/** True when the worktree has no tracked, untracked or submodule changes. */
export async function isWorktreeClean(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<boolean> {
  const { stdout } = await gitExecFileAsync(
    [
      'status',
      '--porcelain',
      '--untracked-files=all',
      // User ignore-submodules config must not hide edits from the dirty check.
      '--ignore-submodules=none'
    ],
    gitReadOptionsForWorktree(worktreePath, options)
  )
  return stdout.trim() === ''
}

type RebaseResult = { status: 'conflict' } | { status: 'done' }

// Why: a non-zero exit with a rebase in progress is a conflict to resolve; any other failure is a real error.
async function runRebase(
  worktreePath: string,
  args: string[],
  options: GitRuntimeOptions,
  env?: NodeJS.ProcessEnv
): Promise<RebaseResult> {
  return runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(async () => {
      try {
        await gitExecFileAsync(args, {
          ...gitOptionsForWorktree(worktreePath, options),
          ...(env ? { env } : {})
        })
        return { status: 'done' }
      } catch (error) {
        if ((await detectConflictOperation(worktreePath, options)) === 'rebase') {
          return { status: 'conflict' }
        }
        throw error
      }
    })
  )
}

/** Replays the commits after `oldParentBase` onto `newParentTip`, so an amended parent is not replayed. */
export async function rebaseLayerOnto(
  worktreePath: string,
  newParentTip: string,
  oldParentBase: string,
  options: GitRuntimeOptions = {}
): Promise<{ status: 'rebased' } | { status: 'conflict' }> {
  const result = await runRebase(
    worktreePath,
    ['rebase', '--onto', newParentTip, oldParentBase],
    options
  )
  return result.status === 'conflict' ? result : { status: 'rebased' }
}

/** Moves HEAD to `targetSha` while keeping local edits; blocked when git would have to overwrite any. */
export async function resetPreviewKeep(
  worktreePath: string,
  targetSha: string,
  options: GitRuntimeOptions = {}
): Promise<{ status: 'moved' } | { status: 'blocked'; reason: string }> {
  return runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(async () => {
      const operationOptions = gitOptionsForWorktree(worktreePath, options)
      // Why: an unresolvable target is a caller bug, not a blocked reset.
      await gitExecFileAsync(['rev-parse', '--verify', `${targetSha}^{commit}`], operationOptions)
      try {
        await gitExecFileAsync(['reset', '--keep', targetSha], operationOptions)
        return { status: 'moved' }
      } catch (error) {
        return { status: 'blocked', reason: getGitErrorReason(error) }
      }
    })
  )
}

/** Applies `patch` to the index and worktree and commits it as a fixup of a layer commit or with a message. */
export async function commitFixup(
  worktreePath: string,
  patch: string,
  target: { fixupOf: string } | { message: string },
  options: GitRuntimeOptions = {}
): Promise<void> {
  await runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(async () => {
      const operationOptions = gitOptionsForWorktree(worktreePath, options)
      await gitExecFileAsync(['apply', '--3way', '--index'], { ...operationOptions, stdin: patch })
      const commitArgs =
        'fixupOf' in target ? [`--fixup=${target.fixupOf}`] : ['-m', target.message]
      await gitExecFileAsync(['commit', '-q', ...commitArgs], operationOptions)
    })
  )
}

/** Folds fixup! commits into their targets within the layer above `parentBase`, without opening an editor. */
export async function autosquashLayer(
  worktreePath: string,
  parentBase: string,
  options: GitRuntimeOptions = {}
): Promise<{ status: 'squashed' } | { status: 'conflict' }> {
  const result = await runRebase(
    worktreePath,
    ['rebase', '-i', '--autosquash', parentBase],
    options,
    { ...process.env, GIT_SEQUENCE_EDITOR: 'true' }
  )
  return result.status === 'conflict' ? result : { status: 'squashed' }
}

function getGitErrorReason(error: unknown): string {
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error ? error.stderr : null
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : String(error)
  return text.trim()
}
