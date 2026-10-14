import type { TuiAgent } from './tui-agent'

export type MissionMember = {
  repoId: string
  /** Worktree created on the mission branch. `null` when creation failed or
   *  the worktree disappeared; the UI offers per-member recreate. */
  worktreeId: string | null
  /** Immutable instance stamp copied from WorktreeMeta. Both identifiers must
   *  match before Mission code may link or delete the worktree. */
  worktreeInstanceId?: string | null
  /** Durable create/delete failure so recovery guidance survives a reload. */
  lastError?: string | null
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
  /** Physical mission root holding direct-child worktrees for local members.
   *  Legacy out-of-root members retain a compatibility link. Resolved lazily
   *  on first session ensure; stable afterwards. */
  rootPath?: string | null
  /** Trusted parent captured with rootPath so changing workspaceDir does not
   *  make an existing Mission root unverifiable. */
  rootBasePath?: string | null
  /** Agent auto-launched in the mission session on first open. Persisted so a
   *  failed eager session ensure can still honor the pick on lazy retry. */
  sessionAgent?: TuiAgent
  createdAt: number
  updatedAt: number
}

export type MissionMemberResult = {
  repoId: string
  worktreeId: string | null
  worktreeInstanceId?: string | null
  error?: string
  warning?: string
}

export type MissionCreateResult = {
  mission: Mission
  memberResults: MissionMemberResult[]
}

export type MissionDeleteResult = {
  deleted: boolean
  memberResults: MissionMemberResult[]
  error?: string
  warning?: string
}

export type RuntimeMissionMemberRecord = {
  repoId: string
  repoName: string | null
  worktreeId: string | null
  worktreePath: string | null
  branch: string
  error?: string
}

/** CLI/runtime projection of a Mission with member worktree locations resolved. */
export type RuntimeMissionRecord = {
  id: string
  name: string
  branch: string
  rootPath: string | null
  members: RuntimeMissionMemberRecord[]
}

export type RuntimeMissionList = { missions: RuntimeMissionRecord[] }

export type RuntimeMissionShow = { mission: RuntimeMissionRecord }

export type RuntimeMissionMutationResult = {
  mission: RuntimeMissionRecord
  memberResults: MissionMemberResult[]
}

export type RuntimeMissionRemoveResult = MissionDeleteResult & { missionId: string }
export type RuntimeMissionSession = { missionId: string; folderId: string; folderPath: string }
