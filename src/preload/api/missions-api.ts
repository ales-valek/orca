import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { MissionRestackReport } from '../../shared/mission-layer-state'
import type {
  Mission,
  MissionAbsorbResult,
  MissionCreateResult,
  MissionDeleteResult,
  MissionMemberResult,
  MissionSlot,
  MissionStackPullRequestsResult,
  MissionStackPushResult,
  MissionTaskResult
} from '../../shared/mission-types'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'

export type MissionsApi = {
  list: () => Promise<Mission[]>
  create: (args: {
    name: string
    branchName?: string
    repoIds: string[]
    sessionAgent?: TuiAgent
    orchestratorRepoId?: string
    devEnvTemplateId?: string
  }) => Promise<MissionCreateResult>
  update: (args: {
    missionId: string
    updates: Partial<Pick<Mission, 'name' | 'tabOrder'>>
  }) => Promise<Mission | null>
  delete: (args: { missionId: string; deleteWorktrees: boolean }) => Promise<MissionDeleteResult>
  addMembers: (args: { missionId: string; repoIds: string[] }) => Promise<MissionCreateResult>
  removeMember: (args: {
    missionId: string
    repoId: string
    deleteWorktree: boolean
  }) => Promise<MissionDeleteResult>
  recreateMemberWorktree: (args: {
    missionId: string
    repoId: string
  }) => Promise<MissionMemberResult>
  /** Recreates a missing task, preview or orchestrator checkout of a repo. */
  recreateSlotWorktree: (args: {
    missionId: string
    repoId: string
    slot: Exclude<MissionSlot, 'member'>
  }) => Promise<MissionMemberResult>
  ensureSession: (args: { missionId: string }) => Promise<FolderWorkspace>
  /** Read-only layer states of every repo stack in the Mission. */
  inspectStacks: (args: { missionId: string }) => Promise<MissionRestackReport[]>
  addTask: (args: {
    missionId: string
    repoId: string
    title: string
    externalRef?: string
  }) => Promise<MissionTaskResult>
  /** Removes the repo's top task and deletes its worktree; `taskId` guards a stale view. */
  removeTask: (args: {
    missionId: string
    repoId: string
    taskId: string
  }) => Promise<MissionTaskResult>
  restack: (args: { missionId: string; repoId?: string }) => Promise<MissionRestackReport[]>
  /** `overrides` maps an ambiguous hunk's `file:line` to the task id that takes it. */
  absorb: (args: {
    missionId: string
    repoId: string
    overrides?: Record<string, string>
  }) => Promise<MissionAbsorbResult>
  createStackPullRequests: (args: {
    missionId: string
    repoId: string
    draft?: boolean
  }) => Promise<MissionStackPullRequestsResult>
  pushStack: (args: { missionId: string; repoId: string }) => Promise<MissionStackPushResult>
  /** Fires after a stack mutation or restack (manual or automatic) so layer states can be re-read. */
  onStacksChanged: (callback: (event: { missionId: string }) => void) => () => void
}
