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

/** One layer of a repo's task stack, stacked above the mission branch. */
export type MissionTask = {
  id: string
  repoId: string
  /** Position in the repo's stack; 1 = directly above the mission branch. */
  order: number
  title: string
  branchName: string
  worktreeId: string | null
  worktreeInstanceId?: string | null
  /** Parent tip this layer was last rebased onto; `rebase --onto` needs it
   *  after the parent was rewritten (autosquash). */
  parentBaseSha: string | null
  /** Slot for an external tracker key (e.g. `OMP-951`); display only for now. */
  externalRef?: string | null
  externalId?: string | null
  lastError?: string | null
  addedAt: number
}

/** Single-purpose worktree of a mission repo (preview or orchestrator). */
export type MissionSlotWorktree = {
  repoId: string
  worktreeId: string | null
  worktreeInstanceId?: string | null
  lastError?: string | null
}

export type MissionSlot = 'member' | 'preview' | 'orchestrator' | `task:${string}`

export type Mission = {
  id: string
  name: string
  /** Shared git branch for every member worktree, e.g. `mission/referral`.
   *  Immutable after creation (renaming a branch across N repos is unsafe). */
  branchName: string
  members: MissionMember[]
  /** Task layers stacked above the mission branch, per member repo. */
  tasks?: MissionTask[]
  /** Per-repo worktree on the preview branch, above the top task layer. */
  previews?: MissionSlotWorktree[]
  /** Repo the root orchestrator runs from; never also a member. */
  orchestratorRepoId?: string | null
  orchestrator?: MissionSlotWorktree | null
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
