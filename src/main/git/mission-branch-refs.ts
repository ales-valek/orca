import { gitReadOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { getBranchTip } from './stack-layer-git'
import { forceDeleteLocalBranch } from './worktrees/removal/worktree-branch-removal'

/** Local branch names under `prefix` (e.g. `mission-task/referral/`); empty when git cannot list them. */
export async function listLocalBranchesUnder(
  repoPath: string,
  prefix: string
): Promise<Set<string>> {
  const pattern = `refs/heads/${prefix.replace(/\/+$/, '')}`
  try {
    const { stdout } = await gitExecFileAsync(
      ['for-each-ref', '--format=%(refname)', pattern],
      gitReadOptionsForWorktree(repoPath)
    )
    return new Set(
      stdout
        .split('\n')
        .filter((ref) => ref.startsWith('refs/heads/'))
        .map((ref) => ref.slice('refs/heads/'.length))
    )
  } catch {
    return new Set()
  }
}

/**
 * Force-deletes an Orca-owned branch (the preview) once its checkout is gone, but only while
 * another branch or remote ref still contains its tip, so no commit becomes unreachable.
 */
export async function deleteOrcaOwnedBranch(
  repoPath: string,
  branch: string
): Promise<'deleted' | 'missing' | 'kept'> {
  const tip = await getBranchTip(repoPath, branch)
  if (!tip) {
    return 'missing'
  }
  const { stdout } = await gitExecFileAsync(
    ['for-each-ref', '--format=%(refname)', '--contains', tip, 'refs/heads', 'refs/remotes'],
    gitReadOptionsForWorktree(repoPath)
  )
  const containedElsewhere = stdout
    .split('\n')
    .some((ref) => ref !== '' && ref !== `refs/heads/${branch}`)
  if (!containedElsewhere) {
    return 'kept'
  }
  await forceDeleteLocalBranch(repoPath, branch, tip)
  return 'deleted'
}
