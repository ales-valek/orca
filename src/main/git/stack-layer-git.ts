import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'
import type { GitConflictOperation } from '../../shared/git-status-types'
import {
  gitOptionsForWorktree,
  gitReadOptionsForWorktree,
  type GitRuntimeOptions
} from './git-runtime-options'
import { listPatchPaths, restorePatchPaths } from './layer-patch-restore'
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

export type LayerWorktreeSnapshot = {
  /** Checked-out branch; null while HEAD is detached (e.g. mid-rebase). */
  branch: string | null
  headSha: string | null
  isClean: boolean
  /** 'unknown' when no merge, rebase or cherry-pick is in progress. */
  operation: GitConflictOperation
}

/** True or false when git decided whether `ancestor` is reachable from `descendant`; null when the probe failed. */
export async function getCommitAncestry(
  worktreePath: string,
  ancestor: string,
  descendant: string,
  options: GitRuntimeOptions = {}
): Promise<boolean | null> {
  if (ancestor.startsWith('-') || descendant.startsWith('-')) {
    return null
  }
  return gitExecFileAsync(
    ['merge-base', '--is-ancestor', ancestor, descendant],
    gitReadOptionsForWorktree(worktreePath, options)
  ).then(
    () => true,
    // Why: only exit 1 means "not an ancestor"; a missing object, timeout or kill says nothing.
    (error: unknown) => (isGitExitCode(error, 1) ? false : null)
  )
}

/** True when `ancestor` is reachable from `descendant`; any failure reads false so callers fail closed. */
export async function isAncestorCommit(
  worktreePath: string,
  ancestor: string,
  descendant: string,
  options: GitRuntimeOptions = {}
): Promise<boolean> {
  return (await getCommitAncestry(worktreePath, ancestor, descendant, options)) === true
}

function isGitExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code &&
    !('killed' in error && error.killed === true)
  )
}

/** Read-only facts restack needs before it may touch a layer checkout. */
export async function readLayerWorktree(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<LayerWorktreeSnapshot> {
  const readOptions = gitReadOptionsForWorktree(worktreePath, options)
  const readTrimmed = (args: string[]): Promise<string | null> =>
    gitExecFileAsync(args, readOptions).then(
      ({ stdout }) => stdout.trim() || null,
      () => null
    )
  const [branch, headSha, isClean, operation] = await Promise.all([
    readTrimmed(['symbolic-ref', '-q', '--short', 'HEAD']),
    readTrimmed(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
    isWorktreeClean(worktreePath, options),
    detectConflictOperation(worktreePath, options)
  ])
  return { branch, headSha, isClean, operation }
}

type RebaseResult = { status: 'conflict' } | { status: 'done' }

// Why: a user's rebase.autoStash would stash concurrent agent edits instead of refusing the dirty tree.
const NO_AUTOSTASH = ['-c', 'rebase.autoStash=false']

// Why: a non-zero exit with a rebase in progress is a conflict to resolve; any other failure is a real error.
async function runRebase(
  worktreePath: string,
  args: string[],
  options: GitRuntimeOptions
): Promise<RebaseResult> {
  return runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(async () => {
      try {
        await gitExecFileAsync(args, gitOptionsForWorktree(worktreePath, options))
        return { status: 'done' }
      } catch (error) {
        const operation = await detectConflictOperation(worktreePath, options).catch(() => null)
        if (operation === 'rebase') {
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
    [...NO_AUTOSTASH, 'rebase', '--onto', newParentTip, oldParentBase],
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
        if (options.signal?.aborted) {
          throw error
        }
        return { status: 'blocked', reason: getGitErrorReason(error) }
      }
    })
  )
}

export type CommitFixupOptions = GitRuntimeOptions & {
  /** Accept zero-context hunks; only for patches whose line numbers are exact for this layer. */
  unidiffZero?: boolean
}

/** Applies `patch` to the index and worktree and commits it as a fixup of a layer commit or with a message. */
export async function commitFixup(
  worktreePath: string,
  patch: string,
  target: { fixupOf: string } | { message: string },
  options: CommitFixupOptions = {}
): Promise<void> {
  await runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(async () => {
      if (!(await isWorktreeClean(worktreePath, options))) {
        throw new Error('mission_layer_not_clean')
      }
      const operationOptions = gitOptionsForWorktree(worktreePath, options)
      const commitArgs =
        'fixupOf' in target ? [`--fixup=${target.fixupOf}`] : ['-m', target.message]
      const applyFlags = options.unidiffZero ? ['--unidiff-zero'] : []
      const paths = await listPatchPaths(worktreePath, patch, applyFlags, options)
      let applied = false
      try {
        await gitExecFileAsync(['apply', '--3way', '--index', ...applyFlags], {
          ...operationOptions,
          stdin: patch
        })
        applied = true
        await gitExecFileAsync(['commit', '-q', ...commitArgs], operationOptions)
      } catch (error) {
        // Why: hooks run for seconds; an edit made meanwhile to any other file must survive.
        const { signal: _abortedSignal, ...restoreOptions } = operationOptions
        await restorePatchPaths(worktreePath, paths, applied, restoreOptions).catch(() => undefined)
        throw error
      }
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
    // Why: -c travels as an argument; env vars are dropped by the WSL `sh -lc` wrapper.
    ['-c', 'sequence.editor=true', ...NO_AUTOSTASH, 'rebase', '-i', '--autosquash', parentBase],
    options
  )
  return result.status === 'conflict' ? result : { status: 'squashed' }
}

/** Commits in `base..tip`, newest first. */
export async function listLayerCommits(
  worktreePath: string,
  base: string,
  tip: string,
  options: GitRuntimeOptions = {}
): Promise<string[]> {
  if (base.startsWith('-') || tip.startsWith('-')) {
    throw new Error('Invalid revision')
  }
  const { stdout } = await gitExecFileAsync(
    ['rev-list', `${base}..${tip}`],
    gitReadOptionsForWorktree(worktreePath, options)
  )
  return stdout.split('\n').filter(Boolean)
}

/**
 * Puts a layer back on `tip`, abandoning an unfinished rebase. Uses `reset --keep`, so it throws
 * rather than overwrite edits made since; it never resets when the rebase state cannot be read.
 */
export async function restoreLayerTip(
  worktreePath: string,
  tip: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  await runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(async () => {
      const operationOptions = gitOptionsForWorktree(worktreePath, options)
      const operation = await detectConflictOperation(worktreePath, options)
      if (operation === 'rebase') {
        await gitExecFileAsync(['rebase', '--abort'], operationOptions)
      } else if (operation !== 'unknown') {
        throw new Error(`A ${operation} is in progress`)
      }
      await gitExecFileAsync(['reset', '-q', '--keep', tip], operationOptions)
    })
  )
}

function getGitErrorReason(error: unknown): string {
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error ? error.stderr : null
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : String(error)
  return text.trim()
}
