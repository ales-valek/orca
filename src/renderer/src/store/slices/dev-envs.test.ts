import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { DevEnvDetail, DevEnvSummary } from '../../../../shared/dev-env/dev-env-types'
import { createDevEnvsSlice, type DevEnvsSlice } from './dev-envs'

// SAFETY: the slice stores summaries and details without reading their fields.
const SUMMARY = { id: 'e1', key: 'kiosek', name: 'Kiosek' } as DevEnvSummary
// SAFETY: see SUMMARY.
const DETAIL = { ...SUMMARY, services: [] } as unknown as DevEnvDetail

function createStore() {
  // SAFETY: the slice only reads and writes its own keys.
  return create<DevEnvsSlice>()((set, get, api) =>
    createDevEnvsSlice(set as never, get as never, api as never)
  )
}

describe('dev envs slice', () => {
  const api = {
    list: vi.fn(async () => ({ envs: [SUMMARY] })),
    show: vi.fn(async () => DETAIL),
    infraStatus: vi.fn(async () => ({ services: [] }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // SAFETY: the slice calls only list, show and infraStatus.
    Object.assign(globalThis, { window: { api: { devEnv: api } } })
  })

  it('stores the environment list', async () => {
    const store = createStore()
    await store.getState().fetchDevEnvs()
    expect(store.getState().devEnvs).toEqual([SUMMARY])
  })

  it('refreshes the list and only the changed detail on a change event', async () => {
    const store = createStore()
    store.getState().selectDevEnv('e1')
    await store.getState().handleDevEnvChanged('e1')
    expect(api.show).toHaveBeenCalledWith({ env: 'e1' })
    expect(store.getState().devEnvDetails.e1).toEqual(DETAIL)
    await store.getState().handleDevEnvChanged('e2')
    expect(api.show).toHaveBeenCalledTimes(1)
  })

  it('keeps an infra error instead of throwing', async () => {
    api.infraStatus.mockRejectedValueOnce(new Error('Docker is not running (docker info failed)'))
    const store = createStore()
    await store.getState().fetchDevEnvInfra()
    expect(store.getState().devEnvInfra).toEqual({
      services: [],
      error: 'Docker is not running (docker info failed)'
    })
  })
})
