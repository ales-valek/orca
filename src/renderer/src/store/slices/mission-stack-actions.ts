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
  inspectMissionStacks: (missionId: string) => Promise<void>
  addMissionTask: (
    missionId: string,
    repoId: string,
    task: { title: string; externalRef?: string }
  ) => Promise<MissionTaskResult | null>
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
    await get().fetchMissions()
    await get().inspectMissionStacks(missionId)
    return result
  }

  return {
    missionStackReports: {},
    missionSlotErrors: {},

    inspectMissionStacks: async (missionId) => {
      try {
        const reports = await window.api.missions.inspectStacks({ missionId })
        set((state) => ({
          missionStackReports: { ...state.missionStackReports, [missionId]: reports }
        }))
      } catch (error) {
        console.error('Failed to inspect mission stacks:', error)
      }
    },

    addMissionTask: async (missionId, repoId, task) => {
      try {
        const result = await window.api.missions.addTask({ missionId, repoId, ...task })
        await get().fetchMissions()
        await get().inspectMissionStacks(missionId)
        return result
      } catch (error) {
        console.error('Failed to add mission task:', error)
        return null
      }
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
      )
  }
}
