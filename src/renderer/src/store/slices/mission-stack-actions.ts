import type { StateCreator } from 'zustand'
import type { MissionRestackReport } from '../../../../shared/mission-layer-state'
import type {
  MissionAbsorbResult,
  MissionSlot,
  MissionStackPullRequestsResult,
  MissionStackPushResult,
  MissionTaskResult
} from '../../../../shared/mission-types'
import type { AppState } from '../types'

type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]

export type MissionStackSlice = {
  /** Read-only layer states per Mission, one report per repo stack. */
  missionStackReports: Record<string, MissionRestackReport[]>
  /** Stack action errors keyed `${missionId}:${repoId}:${slot}`; stack-wide ones use `member`. */
  missionSlotErrors: Record<string, string>
  /** Set when the latest inspection failed; the last reports stay but may be outdated. */
  missionStackReportsStale: Record<string, boolean>
  /** With `unlessInspectedSince`, skips when an inspection already started for that Mission record version. */
  inspectMissionStacks: (
    missionId: string,
    options?: { unlessInspectedSince: number }
  ) => Promise<void>
  addMissionTask: (
    missionId: string,
    repoId: string,
    task: { title: string; externalRef?: string }
  ) => Promise<Pick<MissionTaskResult, 'error' | 'warning'>>
  removeMissionTopTask: (missionId: string, repoId: string, taskId: string) => Promise<void>
  restackMissionRepo: (missionId: string, repoId: string) => Promise<void>
  absorbMissionPreview: (
    missionId: string,
    repoId: string,
    overrides?: Record<string, string>
  ) => Promise<MissionAbsorbResult | null>
  createMissionStackPullRequests: (
    missionId: string,
    repoId: string
  ) => Promise<MissionStackPullRequestsResult | null>
  pushMissionStack: (missionId: string, repoId: string) => Promise<MissionStackPushResult | null>
  recreateMissionSlotWorktree: (
    missionId: string,
    repoId: string,
    slot: Exclude<MissionSlot, 'member'>
  ) => Promise<void>
  /** Main ran a stack mutation or restack; states may change without a record change. */
  refreshMissionStackStates: (missionId: string) => Promise<void>
}

export const missionSlotErrorKey = (missionId: string, repoId: string, slot: MissionSlot): string =>
  `${missionId}:${repoId}:${slot}`

// Why: thrown main-process errors arrive wrapped; the error copy maps the bare code.
const IPC_INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(IPC_INVOKE_PREFIX, '')
}

export function createMissionStackSlice(set: SliceSet, get: SliceGet): MissionStackSlice {
  // Why: inspections overlap (mutations, expand, record refreshes); only the newest may land.
  let inspectionSequence = 0
  const latestInspection = new Map<string, number>()
  const inspectedRecordVersion = new Map<string, number>()

  function setSlotError(key: string, error: string | null | undefined): void {
    set((state) => {
      if (!error && !(key in state.missionSlotErrors)) {
        return {}
      }
      const next = { ...state.missionSlotErrors }
      if (error) {
        next[key] = error
      } else {
        delete next[key]
      }
      return { missionSlotErrors: next }
    })
  }

  /** Runs a stack mutation, records its error on `slot`, then refreshes the catalog and states. */
  async function runStackAction<T>(
    missionId: string,
    repoId: string,
    slot: MissionSlot,
    action: () => Promise<T>,
    getResultError: (result: T) => string | undefined
  ): Promise<T | null> {
    const key = missionSlotErrorKey(missionId, repoId, slot)
    let result: T | null = null
    try {
      result = await action()
      setSlotError(key, getResultError(result))
    } catch (error) {
      setSlotError(key, getErrorMessage(error))
    }
    await refreshAfterMutation(missionId)
    return result
  }

  /** Refreshes the catalog, then inspects unless the refresh already triggered a newer inspection. */
  async function refreshAfterMutation(missionId: string): Promise<void> {
    const inspectionBeforeRefresh = latestInspection.get(missionId)
    await get().fetchMissions()
    if (latestInspection.get(missionId) === inspectionBeforeRefresh) {
      await get().inspectMissionStacks(missionId)
    }
  }

  return {
    missionStackReports: {},
    missionSlotErrors: {},
    missionStackReportsStale: {},

    inspectMissionStacks: async (missionId, options) => {
      const recordVersion = get().missions.find((mission) => mission.id === missionId)?.updatedAt
      const inspectedVersion = inspectedRecordVersion.get(missionId)
      if (
        options &&
        inspectedVersion !== undefined &&
        inspectedVersion >= options.unlessInspectedSince
      ) {
        return
      }
      inspectedRecordVersion.set(missionId, recordVersion ?? 0)
      inspectionSequence += 1
      const request = inspectionSequence
      latestInspection.set(missionId, request)
      try {
        const reports = await window.api.missions.inspectStacks({ missionId })
        if (latestInspection.get(missionId) !== request) {
          return
        }
        set((state) => ({
          missionStackReports: { ...state.missionStackReports, [missionId]: reports },
          missionStackReportsStale: { ...state.missionStackReportsStale, [missionId]: false }
        }))
      } catch (error) {
        if (latestInspection.get(missionId) !== request) {
          return
        }
        console.error('Failed to inspect mission stacks:', error)
        set((state) => ({
          missionStackReportsStale: { ...state.missionStackReportsStale, [missionId]: true }
        }))
      }
    },

    addMissionTask: async (missionId, repoId, task) => {
      let outcome: Pick<MissionTaskResult, 'error' | 'warning'>
      try {
        const result = await window.api.missions.addTask({ missionId, repoId, ...task })
        outcome = {
          ...(result.error ? { error: result.error } : {}),
          ...(result.warning ? { warning: result.warning } : {})
        }
      } catch (error) {
        outcome = { error: getErrorMessage(error) }
      }
      await refreshAfterMutation(missionId)
      return outcome
    },

    removeMissionTopTask: async (missionId, repoId, taskId) => {
      await runStackAction(
        missionId,
        repoId,
        `task:${taskId}`,
        () => window.api.missions.removeTask({ missionId, repoId, taskId }),
        (result) => result.error
      )
    },

    restackMissionRepo: async (missionId, repoId) => {
      await runStackAction(
        missionId,
        repoId,
        'member',
        () => window.api.missions.restack({ missionId, repoId }),
        () => undefined
      )
    },

    absorbMissionPreview: (missionId, repoId, overrides) =>
      runStackAction(
        missionId,
        repoId,
        'preview',
        () =>
          window.api.missions.absorb({
            missionId,
            repoId,
            ...(overrides ? { overrides } : {})
          }),
        () => undefined
      ),

    createMissionStackPullRequests: (missionId, repoId) =>
      runStackAction(
        missionId,
        repoId,
        'member',
        () => window.api.missions.createStackPullRequests({ missionId, repoId }),
        (result) => result.error
      ),

    pushMissionStack: (missionId, repoId) =>
      runStackAction(
        missionId,
        repoId,
        'member',
        () => window.api.missions.pushStack({ missionId, repoId }),
        (result) => result.error
      ),

    recreateMissionSlotWorktree: async (missionId, repoId, slot) => {
      await runStackAction(
        missionId,
        repoId,
        slot,
        () => window.api.missions.recreateSlotWorktree({ missionId, repoId, slot }),
        (result) => result.error
      )
    },

    refreshMissionStackStates: async (missionId) => {
      const state = get()
      const mission = state.missions.find((entry) => entry.id === missionId)
      // Why: a Mission without tasks needs a read only to clear the reports of its last stack.
      if (!mission || (!mission.tasks?.length && !state.missionStackReports[missionId]?.length)) {
        return
      }
      await state.inspectMissionStacks(missionId)
    }
  }
}
