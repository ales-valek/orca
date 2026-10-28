import type { HulyMissionRefreshDiff } from './huly/huly-mission-refresh'
import type { MissionLayerState, MissionRestackReport } from './mission-layer-state'
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
  /** Parent tip a restack was rebasing onto when it hit a conflict; promoted to
   *  `parentBaseSha` once that rebase finishes, dropped when it was aborted. */
  pendingParentBaseSha?: string | null
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
  /** Preview only: top-task tip the preview was last moved to, so a top task
   *  rewritten outside restack can still be followed. */
  followedSha?: string | null
}

export type MissionSlot = 'member' | 'preview' | 'orchestrator' | `task:${string}`

/** Where a Mission was imported from; absent for hand-made Missions. */
export type MissionSource = {
  provider: 'huly'
  serverUrl: string
  workspace: string
  project: string
  milestoneId: string
  milestoneLabel: string
  milestoneUrl: string
  /** Stack order per repo (issue identifiers) captured at import time. */
  importedOrder: Record<string, string[]>
  /** Issue identifier to repo id chosen at import; refresh rebuilds the plan with them. */
  repoOverrides?: Record<string, string>
  lastSyncedAt: number
}

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
  source?: MissionSource | null
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

export type MissionTaskResult = {
  mission: Mission
  task: MissionTask | null
  error?: string
  warning?: string
}

/** Ambiguous hunks are keyed `file:line`; nothing was applied while any remain. */
export type MissionAbsorbResult = {
  applied: number
  ambiguous: { file: string; line: number; candidateTaskIds: string[] }[]
  /** Set when the edits are in their layers but the restack afterwards did not bring them back. */
  warning?: string
}

export type MissionStackPullRequestsResult = {
  created: { branch: string; url: string }[]
  /** Layers that already had an open PR (only distinguishable on the plain-create path). */
  skipped: { branch: string; url?: string }[]
  error?: string
}

export type MissionStackPushResult = { pushed: string[]; error?: string }

export type MissionCreateResult = {
  mission: Mission
  memberResults: MissionMemberResult[]
  orchestratorResult?: MissionMemberResult
}

export type MissionDeleteResult = {
  deleted: boolean
  memberResults: MissionMemberResult[]
  orchestratorResult?: MissionMemberResult
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

export type RuntimeMissionLayerRecord = {
  slot: MissionSlot
  title: string | null
  externalRef: string | null
  branch: string
  worktreePath: string | null
  /** Set by `mission show`; list and mutation projections skip the git reads. */
  state?: MissionLayerState
  reason?: string
}

/** One member repo's layers, bottom-up: member, tasks, then preview. */
export type RuntimeMissionStackRecord = {
  repoId: string
  repoName: string | null
  layers: RuntimeMissionLayerRecord[]
}

export type RuntimeMissionOrchestratorRecord = {
  repoId: string
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
  /** `<rootPath>/MISSION.md`; only for Missions with a `source`. */
  briefPath?: string | null
  members: RuntimeMissionMemberRecord[]
  orchestrator?: RuntimeMissionOrchestratorRecord | null
  /** Only repos with task layers appear. */
  stacks?: RuntimeMissionStackRecord[]
}

export type RuntimeMissionList = { missions: RuntimeMissionRecord[] }

export type RuntimeMissionShow = { mission: RuntimeMissionRecord }

export type RuntimeMissionMutationResult = {
  mission: RuntimeMissionRecord
  memberResults: MissionMemberResult[]
  orchestratorResult?: MissionMemberResult
}

/** Member, layer and brief failures are warnings: the Mission exists either way. */
export type RuntimeMissionHulyCreateResult = {
  mission: RuntimeMissionRecord
  warnings: string[]
}

/** `applied` lists the identifiers appended as task layers; failures land in `warnings`. */
export type RuntimeMissionHulyRefreshResult = {
  mission: RuntimeMissionRecord
  diff: HulyMissionRefreshDiff
  applied: string[]
  warnings: string[]
}

export type RuntimeMissionRemoveResult = MissionDeleteResult & {
  missionId: string
}
export type RuntimeMissionSession = {
  missionId: string
  folderId: string
  folderPath: string
}

export type RuntimeMissionTaskResult = {
  mission: RuntimeMissionRecord
  task: {
    id: string
    title: string
    branch: string
    externalRef: string | null
  } | null
  error?: string
  warning?: string
}

export type RuntimeMissionRestackResult = { reports: MissionRestackReport[] }

export type RuntimeMissionAbsorbResult = {
  applied: number
  ambiguous: {
    file: string
    line: number
    candidateTaskIds: string[]
    /** Tracker key or branch name per candidate, usable with `--choose`. */
    candidateRefs?: string[]
  }[]
  warning?: string
}
