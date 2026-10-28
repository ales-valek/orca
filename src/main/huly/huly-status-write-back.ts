import {
  getHulyProjectSettings,
  type HulyGlobalSettings,
  type HulyStatusRule
} from '../../shared/huly/huly-project-settings'
import { resolveStatusTransition, type MissionEvent } from '../../shared/huly/huly-status-rules'
import type { Mission, MissionSlot, MissionSource, MissionTask } from '../../shared/mission-types'
import type { HulyConnection } from './huly-connection'

const WARNING_PREFIX = 'Huly: '

type HulyStatusWriteBackStore = {
  getMission(missionId: string): Mission | null
  getSettings(): Partial<HulyGlobalSettings>
  setMissionSlotError(
    missionId: string,
    repoId: string,
    slot: MissionSlot,
    error: string | null
  ): unknown
}

type HulyStatusWriteBackDeps = {
  store: HulyStatusWriteBackStore
  connection: Pick<HulyConnection, 'getStatus' | 'withApi'>
  /** Task warnings changed, so the Mission UI should reload. */
  notifyChanged?: () => void
}

export type HulyStatusWriteBackResult = { written: string[]; warnings: string[] }

type LinkedTask = MissionTask & { externalRef: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isLinkedTask(task: MissionTask): task is LinkedTask {
  return typeof task.externalRef === 'string' && task.externalRef !== ''
}

/** Moves linked Huly issues on Mission events; failures become task warnings, never errors. */
export class HulyStatusWriteBack {
  constructor(private readonly deps: HulyStatusWriteBackDeps) {}

  async handle(event: MissionEvent): Promise<HulyStatusWriteBackResult> {
    const result: HulyStatusWriteBackResult = { written: [], warnings: [] }
    try {
      const mission = this.deps.store.getMission(event.missionId)
      const source = mission?.source
      if (!mission || source?.provider !== 'huly') {
        return result
      }
      const settings = getHulyProjectSettings(this.deps.store.getSettings(), source.project)
      const rule = settings.statusRules[event.kind]
      const taskIds = new Set(event.taskIds)
      const tasks = (mission.tasks ?? []).filter(
        (task): task is LinkedTask => taskIds.has(task.id) && isLinkedTask(task)
      )
      if (!settings.statusWriteBack || rule.target === null || tasks.length === 0) {
        return result
      }
      const mismatch = this.getConnectionMismatch(source)
      for (const task of tasks) {
        const outcome = mismatch ?? (await this.writeTask(source.project, rule, task))
        this.recordOutcome(mission.id, task, outcome, result)
      }
    } catch (error) {
      // Why: write-back is advisory; the Mission operation that emitted the event already succeeded.
      result.warnings.push(`${WARNING_PREFIX}${toErrorMessage(error)}`)
    }
    if (result.warnings.length > 0) {
      this.deps.notifyChanged?.()
    }
    return result
  }

  // Why: one Huly workspace is connected at a time; never move a same-named issue in another one.
  private getConnectionMismatch(source: MissionSource): { warning: string } | null {
    const status = this.deps.connection.getStatus()
    if (!status.connected) {
      return null
    }
    const isSameWorkspace =
      status.info.serverUrl.replace(/\/+$/, '') === source.serverUrl.replace(/\/+$/, '') &&
      status.info.workspace === source.workspace
    return isSameWorkspace
      ? null
      : { warning: 'connected to a different workspace than this Mission' }
  }

  private async writeTask(
    project: string,
    rule: HulyStatusRule,
    task: LinkedTask
  ): Promise<{ written: boolean } | { warning: string }> {
    try {
      return await this.deps.connection.withApi(async (api) => {
        const target = resolveStatusTransition(
          rule,
          await api.getIssueStatus(project, task.externalRef)
        )
        if (target === null) {
          return { written: false }
        }
        await api.setIssueStatus(project, task.externalRef, target)
        return { written: true }
      })
    } catch (error) {
      return { warning: toErrorMessage(error) }
    }
  }

  private recordOutcome(
    missionId: string,
    task: LinkedTask,
    outcome: { written: boolean } | { warning: string },
    result: HulyStatusWriteBackResult
  ): void {
    const slot: MissionSlot = `task:${task.id}`
    if ('warning' in outcome) {
      const warning = `${WARNING_PREFIX}${outcome.warning}`
      result.warnings.push(warning)
      this.deps.store.setMissionSlotError(missionId, task.repoId, slot, warning)
      return
    }
    if (outcome.written) {
      result.written.push(task.externalRef)
    }
    if (task.lastError?.startsWith(WARNING_PREFIX)) {
      this.deps.store.setMissionSlotError(missionId, task.repoId, slot, null)
      this.deps.notifyChanged?.()
    }
  }
}
