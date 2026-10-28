import { HulyCodedError } from '../../shared/huly/huly-error-codes'
import { renderMissionBrief } from '../../shared/huly/huly-mission-brief'
import {
  diffMissionAgainstPlan,
  insertAppendedIntoImportedOrder,
  type HulyMissionRefreshDiff
} from '../../shared/huly/huly-mission-refresh'
import {
  buildMissionPlanFromMilestone,
  type HulyMissionPlan
} from '../../shared/huly/huly-mission-plan'
import {
  getHulyProjectSettings,
  type HulyGlobalSettings
} from '../../shared/huly/huly-project-settings'
import type { HulyMilestone } from '../../shared/huly/huly-types'
import type {
  Mission,
  MissionCreateResult,
  MissionSource,
  MissionTaskResult
} from '../../shared/mission-types'
import { slugifyMissionBranch } from '../../shared/missions'
import type { TuiAgent } from '../../shared/tui-agent'
import type { MissionCreateInput } from '../ipc/mission-ipc-args'
import type { MissionAddTaskInput } from '../missions/mission-task-operations'
import type { HulyApi } from './huly-api'
import type { HulyConnection } from './huly-connection'
import { appendStackTasks } from './huly-stack-task-appender'

export type HulyMilestonePlanArgs = {
  project: string
  milestoneId: string
  repoOverrides?: Record<string, string>
  orderOverrides?: Record<string, string[]>
}

export type HulyMissionCreateArgs = HulyMilestonePlanArgs & {
  name?: string
  branchName?: string
  orchestratorRepoId?: string | null
  sessionAgent?: TuiAgent
}

export type HulyMissionCreateResult = {
  mission: Mission
  taskResults: MissionTaskResult[]
  warnings: string[]
}

export type HulyMissionImportDeps = {
  connection: Pick<HulyConnection, 'withApi' | 'getStatus'>
  getSettings: () => Partial<HulyGlobalSettings>
  missions: {
    create(args: MissionCreateInput): Promise<MissionCreateResult>
    addTask(args: MissionAddTaskInput): Promise<MissionTaskResult>
  }
  getMission: (missionId: string) => Mission | null
  setMissionSource: (missionId: string, source: MissionSource) => Mission | null
  /** Writes MISSION.md; false when the Mission root does not exist on disk. */
  writeBrief: (mission: Mission, markdown: string) => boolean
  getRepoName: (repoId: string) => string | null
  now?: () => number
}

export type HulyMissionRefreshResult = {
  diff: HulyMissionRefreshDiff
  applied: MissionTaskResult[]
  warnings: string[]
}

/** Carries the issues that keep the plan from becoming a Mission. */
export class HulyPlanUnresolvedError extends Error {
  readonly code = 'huly_plan_unresolved'
  readonly data: { unmapped: string[]; cycles: HulyMissionPlan['cycles'] }

  constructor(plan: HulyMissionPlan) {
    const unmapped = plan.unmapped.map((issue) => issue.identifier)
    const details = [
      ...(unmapped.length > 0 ? [`unmapped issues ${unmapped.join(', ')}`] : []),
      ...plan.cycles.map(
        (cycle) => `blockedBy cycle in ${cycle.repoId}: ${cycle.identifiers.join(', ')}`
      )
    ]
    super(`huly_plan_unresolved: ${details.join('; ')}`)
    this.data = { unmapped, cycles: plan.cycles }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getPlanOrder(plan: HulyMissionPlan): Record<string, string[]> {
  return Object.fromEntries(
    plan.stacks.map((stack) => [stack.repoId, stack.tasks.map((task) => task.issue.identifier)])
  )
}

/** The project as given, else the only configured project, else the only project in the workspace. */
export async function resolveHulyProject(
  api: Pick<HulyApi, 'listProjects'>,
  settings: Partial<HulyGlobalSettings>,
  project: string | undefined
): Promise<string> {
  if (project?.trim()) {
    return project.trim()
  }
  const configured = Object.keys(settings.hulyProjects ?? {})
  if (configured.length === 1) {
    return configured[0]
  }
  const projects = await api.listProjects()
  if (projects.length === 1) {
    return projects[0].identifier
  }
  const available = projects.map((entry) => entry.identifier).join(', ')
  throw new HulyCodedError(
    'huly_project_required',
    `huly_project_required: pass --project (one of ${available || 'none'})`
  )
}

/** Accepts a milestone id or its exact label, compared case-insensitively. */
export async function resolveHulyMilestoneId(
  api: Pick<HulyApi, 'listMilestones'>,
  project: string,
  selector: string
): Promise<string> {
  const milestones = await api.listMilestones(project)
  const wanted = selector.trim()
  const byId = milestones.find((milestone) => milestone.id === wanted)
  if (byId) {
    return byId.id
  }
  const label = wanted.toLocaleLowerCase()
  const byLabel = milestones.filter((milestone) => milestone.label.toLocaleLowerCase() === label)
  if (byLabel.length > 1) {
    throw new HulyCodedError(
      'huly_milestone_ambiguous',
      `huly_milestone_ambiguous: ${byLabel.map((m) => m.id).join(', ')}`
    )
  }
  if (byLabel.length === 0) {
    throw new HulyCodedError(
      'huly_milestone_not_found',
      `huly_milestone_not_found: ${wanted} in ${project}`
    )
  }
  return byLabel[0].id
}

/** Turns a Huly milestone into a Mission: every Huly read happens before the first Mission write. */
export class HulyMissionImport {
  constructor(private readonly deps: HulyMissionImportDeps) {}

  async getMilestonePlan(
    args: HulyMilestonePlanArgs
  ): Promise<{ milestone: HulyMilestone; plan: HulyMissionPlan }> {
    const { milestone, plan } = await this.readPlan(args)
    return { milestone, plan }
  }

  async createMissionFromMilestone(args: HulyMissionCreateArgs): Promise<HulyMissionCreateResult> {
    const { milestone, plan, importedOrder } = await this.readPlan(args)
    if (plan.unmapped.length > 0 || plan.cycles.length > 0) {
      throw new HulyPlanUnresolvedError(plan)
    }
    if (plan.stacks.length === 0) {
      throw new Error('huly_plan_empty')
    }
    const status = this.deps.connection.getStatus()
    if (!status.connected) {
      throw new Error('huly_not_connected')
    }

    const created = await this.deps.missions.create({
      name: args.name?.trim() || milestone.label,
      repoIds: plan.stacks.map((stack) => stack.repoId),
      branchName: args.branchName?.trim() || slugifyMissionBranch(milestone.label),
      ...(args.orchestratorRepoId ? { orchestratorRepoId: args.orchestratorRepoId } : {}),
      ...(args.sessionAgent ? { sessionAgent: args.sessionAgent } : {})
    })
    const missionId = created.mission.id
    const warnings = [
      ...created.memberResults,
      ...(created.orchestratorResult ? [created.orchestratorResult] : [])
    ].flatMap((result) =>
      [result.error, result.warning].flatMap((text) => (text ? [`${result.repoId}: ${text}`] : []))
    )

    // Why: recorded before the layers so a crash mid-import still knows the Mission's origin.
    this.deps.setMissionSource(missionId, {
      provider: 'huly',
      serverUrl: status.info.serverUrl,
      workspace: status.info.workspace,
      project: args.project,
      milestoneId: milestone.id,
      milestoneLabel: milestone.label,
      milestoneUrl: milestone.url,
      importedOrder,
      ...(args.repoOverrides && Object.keys(args.repoOverrides).length > 0
        ? { repoOverrides: args.repoOverrides }
        : {}),
      lastSyncedAt: (this.deps.now ?? Date.now)()
    })

    const taskResults: MissionTaskResult[] = []
    for (const stack of plan.stacks) {
      const result = await appendStackTasks(
        this.deps.missions.addTask,
        missionId,
        stack,
        taskResults
      )
      warnings.push(...result.warnings)
    }

    const mission = this.deps.getMission(missionId) ?? created.mission
    warnings.push(...this.writeBrief(mission, milestone, plan))
    return { mission, taskResults, warnings }
  }

  /** Diffs the Mission against its milestone; with `apply` only appendable issues are added on top. */
  async refreshMissionFromHuly(args: {
    missionId: string
    apply: boolean
  }): Promise<HulyMissionRefreshResult> {
    const mission = this.deps.getMission(args.missionId)
    if (!mission) {
      throw new Error('mission_not_found')
    }
    const { source } = mission
    if (!source) {
      throw new Error('mission_not_from_huly')
    }
    const { milestone, plan } = await this.readPlan({
      project: source.project,
      milestoneId: source.milestoneId,
      repoOverrides: source.repoOverrides
    })
    const diff = diffMissionAgainstPlan(mission, plan)
    if (!args.apply) {
      return { diff, applied: [], warnings: [] }
    }

    const applied: MissionTaskResult[] = []
    const warnings: string[] = []
    const importedOrder = { ...source.importedOrder }
    for (const { repoId, issues } of diff.appendable) {
      const wanted = new Set(issues.map((issue) => issue.identifier))
      const tasks = (plan.stacks.find((stack) => stack.repoId === repoId)?.tasks ?? []).filter(
        (task) => wanted.has(task.issue.identifier)
      )
      const result = await appendStackTasks(
        this.deps.missions.addTask,
        mission.id,
        { repoId, tasks },
        applied
      )
      warnings.push(...result.warnings)
      importedOrder[repoId] = insertAppendedIntoImportedOrder(
        importedOrder[repoId] ?? [],
        result.appended,
        (plan.stacks.find((stack) => stack.repoId === repoId)?.tasks ?? []).map(
          (task) => task.issue.identifier
        )
      )
    }
    this.deps.setMissionSource(mission.id, {
      ...source,
      importedOrder,
      lastSyncedAt: (this.deps.now ?? Date.now)()
    })
    warnings.push(...this.writeBrief(this.deps.getMission(mission.id) ?? mission, milestone, plan))
    return { diff, applied, warnings }
  }

  private async readPlan(args: HulyMilestonePlanArgs): Promise<{
    milestone: HulyMilestone
    plan: HulyMissionPlan
    importedOrder: Record<string, string[]>
  }> {
    const { milestone, issues } = await this.deps.connection.withApi(async (api) => ({
      milestone: await api.getMilestone(args.project, args.milestoneId),
      issues: await api.listMilestoneIssues(args.project, args.milestoneId)
    }))
    const settings = getHulyProjectSettings(this.deps.getSettings(), args.project)
    const input = { issues, settings, repoOverrides: args.repoOverrides }
    const importedPlan = buildMissionPlanFromMilestone(input)
    const plan = args.orderOverrides
      ? buildMissionPlanFromMilestone({ ...input, orderOverrides: args.orderOverrides })
      : importedPlan
    return { milestone, plan, importedOrder: getPlanOrder(importedPlan) }
  }

  private writeBrief(mission: Mission, milestone: HulyMilestone, plan: HulyMissionPlan): string[] {
    const repoNames: Record<string, string> = {}
    for (const stack of plan.stacks) {
      repoNames[stack.repoId] = this.deps.getRepoName(stack.repoId) ?? stack.repoId
    }
    try {
      const markdown = renderMissionBrief({ milestone, plan, mission, repoNames })
      return this.deps.writeBrief(mission, markdown)
        ? []
        : ['MISSION.md was not written: the Mission root does not exist yet']
    } catch (error) {
      return [`MISSION.md was not written: ${toErrorMessage(error)}`]
    }
  }
}
