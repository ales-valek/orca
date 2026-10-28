import type { MissionRestackReport } from '../../shared/mission-layer-state'
import type {
  Mission,
  MissionTaskResult,
  RuntimeMissionAbsorbResult,
  RuntimeMissionList,
  RuntimeMissionMutationResult,
  RuntimeMissionRecord,
  RuntimeMissionRemoveResult,
  RuntimeMissionRestackResult,
  RuntimeMissionSession,
  RuntimeMissionShow,
  RuntimeMissionTaskResult
} from '../../shared/mission-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type { MissionOperations } from '../missions/mission-operations'
import {
  findMissionForPath,
  resolveMissionSelector,
  toRuntimeMissionRecord
} from '../missions/mission-runtime-records'
import { findMissionTaskIdByRef, getMissionTaskDisplayRef } from '../missions/mission-task-refs'
import { InvalidArgumentError } from './rpc/core'
import { OrcaRuntimeWithMissionOwnership } from './orca-runtime-mission-ownership'

export type RuntimeMissionCreateInput = {
  name: string
  repos: string[]
  branch?: string
  agent?: TuiAgent
}

export abstract class OrcaRuntimeWithMissionCommands extends OrcaRuntimeWithMissionOwnership {
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

  async showMission(selector: string): Promise<RuntimeMissionShow> {
    const mission = resolveMissionSelector(this.requireMissionOperations().list(), selector)
    return { mission: await this.toInspectedMissionRecord(mission) }
  }

  async showMissionForPath(targetPath: string): Promise<RuntimeMissionShow> {
    const mission = findMissionForPath(this.requireMissionOperations().list(), targetPath)
    if (!mission) {
      throw new Error('selector_not_found')
    }
    return { mission: await this.toInspectedMissionRecord(mission) }
  }

  /** Adds layer states from git; a repo whose inspection fails keeps its layers without state. */
  private async toInspectedMissionRecord(mission: Mission): Promise<RuntimeMissionRecord> {
    const operations = this.requireMissionOperations()
    const record = toRuntimeMissionRecord(this.requireStore(), mission)
    for (const stack of record.stacks ?? []) {
      try {
        const report = await operations.inspectRepo(mission, stack.repoId)
        for (const layer of stack.layers) {
          const inspected = report.layers.find((entry) => entry.slot === layer.slot)
          if (inspected) {
            layer.state = inspected.state
            if (inspected.reason) {
              layer.reason = inspected.reason
            }
          }
        }
      } catch (error) {
        console.error('[missions] layer inspection failed:', error)
      }
    }
    return record
  }

  /** Hook for the runtime layer that owns agent transitions. */
  protected notifyMissionAgentTurnEnded(worktreeId: string): void {
    this.missionOperations?.onAgentTurnEnded(worktreeId)
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

  async addMissionTask(
    selector: string,
    repoSelector: string,
    title: string,
    ref?: string
  ): Promise<RuntimeMissionTaskResult> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const repoId = (await this.resolveRepoSelector(repoSelector)).id
    const result = await operations.addTask({
      missionId: mission.id,
      repoId,
      title,
      ...(ref ? { externalRef: ref } : {})
    })
    return this.toRuntimeTaskResult(result)
  }

  async removeMissionTask(
    selector: string,
    repoSelector: string
  ): Promise<RuntimeMissionTaskResult> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const repoId = (await this.resolveRepoSelector(repoSelector)).id
    // Why: a layer checkout inside the Mission root cannot be kept, so removal always deletes it.
    return this.toRuntimeTaskResult(
      await operations.removeTopTask({ missionId: mission.id, repoId, deleteWorktree: true })
    )
  }

  async restackMission(
    selector: string,
    repoSelector?: string
  ): Promise<RuntimeMissionRestackResult> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const repoId = repoSelector ? (await this.resolveRepoSelector(repoSelector)).id : undefined
    const reports: MissionRestackReport[] = await operations.restack({
      missionId: mission.id,
      ...(repoId ? { repoId } : {})
    })
    return { reports }
  }

  async absorbMissionPreview(
    selector: string,
    repoSelector: string,
    choose: Record<string, string> = {}
  ): Promise<RuntimeMissionAbsorbResult> {
    const operations = this.requireMissionOperations()
    const mission = resolveMissionSelector(operations.list(), selector)
    const repoId = (await this.resolveRepoSelector(repoSelector)).id
    const overrides: Record<string, string> = {}
    for (const [hunk, ref] of Object.entries(choose)) {
      const taskId = findMissionTaskIdByRef(mission, repoId, ref)
      if (!taskId) {
        const valid = (mission.tasks ?? [])
          .filter((task) => task.repoId === repoId)
          .map(getMissionTaskDisplayRef)
        throw new InvalidArgumentError(
          `Unknown task ref "${ref}" for ${hunk}. Valid refs: ${valid.join(', ') || '(none)'}`
        )
      }
      overrides[hunk] = taskId
    }
    const result = await operations.absorb({ missionId: mission.id, repoId, overrides })
    const tasks = mission.tasks ?? []
    return {
      ...result,
      ambiguous: result.ambiguous.map((hunk) => ({
        ...hunk,
        candidateRefs: hunk.candidateTaskIds.map((id) => {
          const task = tasks.find((entry) => entry.id === id)
          return task ? getMissionTaskDisplayRef(task) : id
        })
      }))
    }
  }

  private toRuntimeTaskResult(result: MissionTaskResult): RuntimeMissionTaskResult {
    return {
      mission: toRuntimeMissionRecord(this.requireStore(), result.mission),
      task: result.task
        ? {
            id: result.task.id,
            title: result.task.title,
            branch: result.task.branchName,
            externalRef: result.task.externalRef ?? null
          }
        : null,
      ...(result.error ? { error: result.error } : {}),
      ...(result.warning ? { warning: result.warning } : {})
    }
  }
}
