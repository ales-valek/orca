import type { HulyConnectionInfo } from '../../shared/huly/huly-types'
import type {
  RuntimeMissionHulyCreateResult,
  RuntimeMissionHulyRefreshResult
} from '../../shared/mission-types'
import type { TuiAgent } from '../../shared/tui-agent'
import { HulyConnection } from '../huly/huly-connection'
import { HulyMissionImport, type HulyMilestonePlanArgs } from '../huly/huly-mission-import'
import { resolveHulyMilestoneId, resolveHulyProject } from '../huly/huly-milestone-selectors'
import { writeMissionBriefIfRooted } from '../missions/mission-brief-file'
import { resolveMissionSelector, toRuntimeMissionRecord } from '../missions/mission-runtime-records'
import { OrcaRuntimeWithMissionCommands } from './orca-runtime-mission-commands'

export type RuntimeMissionCreateFromHulyInput = {
  milestone: string
  project?: string
  name?: string
  branch?: string
  agent?: TuiAgent
  orchestratorRepo?: string
  repoOverrides?: Record<string, string>
  orderOverrides?: Record<string, string[]>
}

export abstract class OrcaRuntimeWithHulyCommands extends OrcaRuntimeWithMissionCommands {
  private hulyConnection: HulyConnection | null = null

  /** One Huly connection per process, shared by RPC and desktop IPC. */
  getHulyConnection(): HulyConnection {
    this.hulyConnection ??= new HulyConnection()
    return this.hulyConnection
  }

  /** Lets tests run against a connection over a fake API. */
  attachHulyConnection(connection: HulyConnection): void {
    this.hulyConnection = connection
  }

  private createHulyMissionImport(): HulyMissionImport {
    const store = this.requireStore()
    return new HulyMissionImport({
      connection: this.getHulyConnection(),
      getSettings: () => store.getSettings(),
      // Why: resolved per call so plan previews work while no desktop window owns Missions.
      missions: {
        create: (args) => this.requireMissionOperations().create(args),
        addTask: (args) => this.requireMissionOperations().addTask(args)
      },
      getMission: (missionId) => store.getMission?.(missionId) ?? null,
      setMissionSource: (missionId, source) => {
        if (!store.setMissionSource) {
          throw new Error('Missions are only available while the Orca desktop window is running.')
        }
        return store.setMissionSource(missionId, source)
      },
      writeBrief: (mission, markdown) => writeMissionBriefIfRooted(store, mission, markdown),
      getRepoName: (repoId) => store.getRepo(repoId)?.displayName ?? null
    })
  }

  hulyConnect(args: HulyConnectionInfo & { token: string }) {
    return this.getHulyConnection().connect(args)
  }

  async hulyDisconnect(): Promise<{ ok: true }> {
    await this.getHulyConnection().disconnect()
    return { ok: true }
  }

  hulyStatus() {
    return this.getHulyConnection().getStatus()
  }

  hulyListProjects() {
    return this.getHulyConnection().withApi((api) => api.listProjects())
  }

  hulyListMilestones(project: string) {
    return this.getHulyConnection().withApi((api) => api.listMilestones(project))
  }

  hulyListStatuses(project: string) {
    return this.getHulyConnection().withApi((api) => api.listStatuses(project))
  }

  hulyListComponents(project: string) {
    return this.getHulyConnection().withApi((api) => api.listComponents(project))
  }

  hulyGetMilestonePlan(args: HulyMilestonePlanArgs) {
    return this.createHulyMissionImport().getMilestonePlan(args)
  }

  async createMissionFromHuly(
    input: RuntimeMissionCreateFromHulyInput
  ): Promise<RuntimeMissionHulyCreateResult> {
    // Why: fail before touching Huly when no desktop window can own the Mission.
    this.requireMissionOperations()
    const store = this.requireStore()
    const orchestratorRepoId = input.orchestratorRepo
      ? (await this.resolveRepoSelector(input.orchestratorRepo)).id
      : null
    const { project, milestoneId } = await this.getHulyConnection().withApi(async (api) => {
      const resolved = await resolveHulyProject(api, store.getSettings(), input.project)
      return {
        project: resolved,
        milestoneId: await resolveHulyMilestoneId(api, resolved, input.milestone)
      }
    })
    const result = await this.createHulyMissionImport().createMissionFromMilestone({
      project,
      milestoneId,
      orchestratorRepoId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.branch ? { branchName: input.branch } : {}),
      ...(input.agent ? { sessionAgent: input.agent } : {}),
      ...(input.repoOverrides ? { repoOverrides: input.repoOverrides } : {}),
      ...(input.orderOverrides ? { orderOverrides: input.orderOverrides } : {})
    })
    return {
      mission: toRuntimeMissionRecord(store, result.mission),
      warnings: result.warnings
    }
  }

  async refreshMissionFromHuly(
    selector: string,
    apply: boolean
  ): Promise<RuntimeMissionHulyRefreshResult> {
    const operations = this.requireMissionOperations()
    const store = this.requireStore()
    const target = resolveMissionSelector(operations.list(), selector)
    const result = await this.createHulyMissionImport().refreshMissionFromHuly({
      missionId: target.id,
      apply
    })
    const mission = store.getMission?.(target.id) ?? target
    return {
      mission: toRuntimeMissionRecord(store, mission),
      diff: result.diff,
      applied: result.applied.flatMap((entry) =>
        entry.task?.externalRef ? [entry.task.externalRef] : []
      ),
      warnings: result.warnings
    }
  }
}
