import type {
  RuntimeMissionList,
  RuntimeMissionMutationResult,
  RuntimeMissionRemoveResult,
  RuntimeMissionSession,
  RuntimeMissionShow
} from '../../shared/mission-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type { MissionOperations } from '../missions/mission-operations'
import {
  findMissionForPath,
  resolveMissionSelector,
  toRuntimeMissionRecord
} from '../missions/mission-runtime-records'
import { OrcaRuntimeWithMissionOwnership } from './orca-runtime-mission-ownership'

export type RuntimeMissionCreateInput = {
  name: string
  repos: string[]
  branch?: string
  agent?: TuiAgent
}

export class OrcaRuntimeWithMissionCommands extends OrcaRuntimeWithMissionOwnership {
  private missionOperations: MissionOperations | null = null

  /** The desktop window owns Mission IPC; RPC reuses its instance for shared locks and UI refresh. */
  attachMissionOperations(operations: MissionOperations): void {
    this.missionOperations = operations
  }

  private requireMissionOperations(): MissionOperations {
    if (!this.missionOperations) {
      // Why: headless `orca serve` has no Mission UI host to refresh or serialize against.
      throw new Error('Missions are only available while the Orca desktop window is running.')
    }
    return this.missionOperations
  }

  private async resolveMissionRepoIds(selectors: readonly string[]): Promise<string[]> {
    const repoIds: string[] = []
    for (const selector of selectors) {
      repoIds.push((await this.resolveRepoSelector(selector)).id)
    }
    return [...new Set(repoIds)]
  }

  listMissions(): RuntimeMissionList {
    const store = this.requireStore()
    return {
      missions: this.requireMissionOperations()
        .list()
        .map((mission) => toRuntimeMissionRecord(store, mission))
    }
  }

  showMission(selector: string): RuntimeMissionShow {
    const store = this.requireStore()
    const mission = resolveMissionSelector(this.requireMissionOperations().list(), selector)
    return { mission: toRuntimeMissionRecord(store, mission) }
  }

  showMissionForPath(targetPath: string): RuntimeMissionShow {
    const store = this.requireStore()
    const mission = findMissionForPath(this.requireMissionOperations().list(), targetPath)
    if (!mission) {
      throw new Error('selector_not_found')
    }
    return { mission: toRuntimeMissionRecord(store, mission) }
  }

  async createMissionFromSelectors(
    input: RuntimeMissionCreateInput
  ): Promise<RuntimeMissionMutationResult> {
    const operations = this.requireMissionOperations()
    const result = await operations.create({
      name: input.name,
      repoIds: await this.resolveMissionRepoIds(input.repos),
      ...(input.branch ? { branchName: input.branch } : {}),
      ...(input.agent ? { sessionAgent: input.agent } : {})
    })
    return {
      mission: toRuntimeMissionRecord(this.requireStore(), result.mission),
      memberResults: result.memberResults
    }
  }

  async ensureMissionSession(selector: string): Promise<RuntimeMissionSession> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const workspace = await operations.ensureSession(mission.id)
    return { missionId: mission.id, folderId: workspace.id, folderPath: workspace.folderPath }
  }

  async addMissionRepos(selector: string, repos: string[]): Promise<RuntimeMissionMutationResult> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const result = await operations.addMembers({
      missionId: mission.id,
      repoIds: await this.resolveMissionRepoIds(repos)
    })
    return {
      mission: toRuntimeMissionRecord(this.requireStore(), result.mission),
      memberResults: result.memberResults
    }
  }

  async removeMission(
    selector: string,
    deleteWorktrees: boolean
  ): Promise<RuntimeMissionRemoveResult> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const result = await operations.delete({ missionId: mission.id, deleteWorktrees })
    return { missionId: mission.id, ...result }
  }
}
