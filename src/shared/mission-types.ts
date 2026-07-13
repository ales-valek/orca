import type { TuiAgent } from './tui-agent'

export type MissionMember = {
  repoId: string
  /** Worktree created on the mission branch. `null` when creation failed or
   *  the worktree disappeared; the UI offers per-member recreate. */
  worktreeId: string | null
  addedAt: number
}

export type Mission = {
  id: string
  name: string
  /** Shared git branch for every member worktree, e.g. `mission/referral`.
   *  Immutable after creation (renaming a branch across N repos is unsafe). */
  branchName: string
  members: MissionMember[]
  tabOrder: number
  /** Physical mission root holding symlinks to local member worktrees.
   *  Resolved lazily on first session ensure; stable afterwards. */
  rootPath?: string | null
  /** Agent auto-launched in the mission session on first open. Persisted so a
   *  failed eager session ensure can still honor the pick on lazy retry. */
  sessionAgent?: TuiAgent
  createdAt: number
  updatedAt: number
}

export type MissionMemberResult = {
  repoId: string
  worktreeId: string | null
  error?: string
}

export type MissionCreateResult = {
  mission: Mission
  memberResults: MissionMemberResult[]
}

export type MissionDeleteResult = {
  deleted: boolean
  memberResults: MissionMemberResult[]
}
