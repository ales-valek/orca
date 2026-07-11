import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type {
  Mission,
  MissionCreateResult,
  MissionDeleteResult,
  MissionMemberResult
} from '../../shared/mission-types'

export type MissionsApi = {
  list: () => Promise<Mission[]>
  create: (args: {
    name: string
    branchName?: string
    repoIds: string[]
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
  ensureSession: (args: { missionId: string }) => Promise<FolderWorkspace>
}
