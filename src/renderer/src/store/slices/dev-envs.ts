import type { StateCreator } from 'zustand'
import type {
  DevEnvDetail,
  DevEnvInfraState,
  DevEnvSummary
} from '../../../../shared/dev-env/dev-env-types'
import type { AppState } from '../types'

export type DevEnvInfraView = { services: DevEnvInfraState[]; error?: string }

export type DevEnvsSlice = {
  devEnvs: DevEnvSummary[]
  devEnvDetails: Record<string, DevEnvDetail>
  devEnvInfra: DevEnvInfraView | null
  selectedDevEnvId: string | null
  fetchDevEnvs: () => Promise<void>
  refreshDevEnv: (id: string) => Promise<void>
  fetchDevEnvInfra: () => Promise<void>
  selectDevEnv: (id: string | null) => void
  /** Push from main: the list always, the detail only when it is shown. */
  handleDevEnvChanged: (id: string) => Promise<void>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const createDevEnvsSlice: StateCreator<AppState, [], [], DevEnvsSlice> = (set, get) => ({
  devEnvs: [],
  devEnvDetails: {},
  devEnvInfra: null,
  selectedDevEnvId: null,
  fetchDevEnvs: async () => {
    const api = window.api.devEnv
    if (!api) {
      return
    }
    const { envs } = await api.list()
    set({ devEnvs: envs })
  },
  refreshDevEnv: async (id) => {
    const api = window.api.devEnv
    if (!api) {
      return
    }
    try {
      const detail = await api.show({ env: id })
      set((state) => ({ devEnvDetails: { ...state.devEnvDetails, [id]: detail } }))
    } catch {
      // Why: a deleted env disappears from the list on the same refresh.
      set((state) => {
        const { [id]: _removed, ...rest } = state.devEnvDetails
        return { devEnvDetails: rest }
      })
    }
  },
  fetchDevEnvInfra: async () => {
    const api = window.api.devEnv
    if (!api) {
      return
    }
    try {
      set({ devEnvInfra: await api.infraStatus() })
    } catch (error) {
      set({ devEnvInfra: { services: [], error: getErrorMessage(error) } })
    }
  },
  selectDevEnv: (id) => set({ selectedDevEnvId: id }),
  handleDevEnvChanged: async (id) => {
    await get().fetchDevEnvs()
    if (get().selectedDevEnvId === id || get().devEnvDetails[id]) {
      await get().refreshDevEnv(id)
    }
  }
})
