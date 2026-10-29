import type { DevEnv } from '../../../shared/dev-env/dev-env-types'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type DevEnvPersistenceRuntime = Pick<StoreRuntimeState, 'state'>

const devEnvPersistenceContext = Symbol('DevEnvPersistence')
type DevEnvPersistenceContext = {
  runtime: DevEnvPersistenceRuntime
  scheduling: WriteSchedulingOperations
}

export class DevEnvPersistence {
  readonly [devEnvPersistenceContext]: DevEnvPersistenceContext

  constructor(runtime: DevEnvPersistenceRuntime, scheduling: WriteSchedulingOperations) {
    this[devEnvPersistenceContext] = { runtime, scheduling }
  }

  getDevEnvs(): DevEnv[] {
    return [...(this[devEnvPersistenceContext].runtime.state.devEnvs ?? [])]
  }

  getDevEnv(id: string): DevEnv | null {
    return (
      (this[devEnvPersistenceContext].runtime.state.devEnvs ?? []).find((env) => env.id === id) ??
      null
    )
  }

  createDevEnv(env: DevEnv): DevEnv {
    const state = this[devEnvPersistenceContext].runtime.state
    state.devEnvs = [...(state.devEnvs ?? []), env]
    scheduleSave(this[devEnvPersistenceContext].scheduling)
    return env
  }

  updateDevEnv(id: string, updates: Partial<Omit<DevEnv, 'id'>>): DevEnv | null {
    const state = this[devEnvPersistenceContext].runtime.state
    const current = this.getDevEnv(id)
    if (!current) {
      return null
    }
    const updated: DevEnv = { ...current, ...updates }
    state.devEnvs = (state.devEnvs ?? []).map((env) => (env.id === id ? updated : env))
    scheduleSave(this[devEnvPersistenceContext].scheduling)
    return updated
  }

  deleteDevEnv(id: string): boolean {
    const state = this[devEnvPersistenceContext].runtime.state
    const before = state.devEnvs ?? []
    state.devEnvs = before.filter((env) => env.id !== id)
    if (state.devEnvs.length === before.length) {
      return false
    }
    scheduleSave(this[devEnvPersistenceContext].scheduling)
    return true
  }
}
