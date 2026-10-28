import type { HulyMissionPlan } from '../../shared/huly/huly-mission-plan'
import type {
  HulyComponent,
  HulyConnectionStatus,
  HulyMilestone,
  HulyMilestoneSummary,
  HulyProjectSummary,
  HulyStatus
} from '../../shared/huly/huly-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type {
  RuntimeMissionHulyCreateResult,
  RuntimeMissionHulyRefreshResult
} from '../../shared/mission-types'

/** Failures reject with the runtime's `huly_*` code in the error message. */
export type HulyApi = {
  connect: (args: {
    serverUrl: string
    workspace: string
    token: string
  }) => Promise<HulyConnectionStatus>
  disconnect: () => Promise<{ ok: true }>
  status: () => Promise<HulyConnectionStatus>
  listProjects: () => Promise<HulyProjectSummary[]>
  listMilestones: (args: { project: string }) => Promise<HulyMilestoneSummary[]>
  listStatuses: (args: { project: string }) => Promise<HulyStatus[]>
  listComponents: (args: { project: string }) => Promise<HulyComponent[]>
  getMilestonePlan: (args: {
    project: string
    milestoneId: string
    /** Huly issue identifier -> Orca repo id. */
    repoOverrides?: Record<string, string>
    /** Orca repo id -> issue identifiers in stack order. */
    orderOverrides?: Record<string, string[]>
  }) => Promise<{ milestone: HulyMilestone; plan: HulyMissionPlan }>
  createMission: (args: {
    /** Milestone id or exact label. */
    milestone: string
    project?: string
    name?: string
    branch?: string
    agent?: TuiAgent
    orchestratorRepo?: string
    repoOverrides?: Record<string, string>
    orderOverrides?: Record<string, string[]>
  }) => Promise<RuntimeMissionHulyCreateResult>
  refreshMission: (args: {
    mission: string
    apply?: boolean
  }) => Promise<RuntimeMissionHulyRefreshResult>
}
