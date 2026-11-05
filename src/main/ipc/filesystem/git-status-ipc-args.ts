import type { GitAdmissionTier } from '../../git/command-runner/git-exec-options'

export type GitStatusIpcArgs = {
  worktreePath: string
  authorizedParentPath?: string
  connectionId?: string
  admissionTier?: GitAdmissionTier
  includeIgnored?: boolean
  includeLineStats?: boolean
  bypassEffectiveUpstreamNegativeCache?: boolean
  reuseLineStats?: boolean
  branchLineTotalMergeBase?: string
  requestToken?: string
  /** The active workspace's first status: a user act that may start its WSL distro. */
  wakeWslDistro?: boolean
}
