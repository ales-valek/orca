import { describe, expect, it, vi } from 'vitest'
import { getHostOperationOwnership } from '../../../../shared/host-operation-ownership'
import { DevEnvCreateParams } from '../../../../shared/rpc-contract/dev-env-params'
import { eraseRpcMethods } from '../core'
import { DEV_ENV_METHODS } from './dev-env'

function getMethod(name: string) {
  const method = eraseRpcMethods(DEV_ENV_METHODS).find((entry) => entry.name === name)
  if (!method) {
    throw new Error(`missing ${name}`)
  }
  return method
}

describe('devenv RPC', () => {
  it('requires exactly one create target', () => {
    expect(DevEnvCreateParams.safeParse({ template: 't', mission: 'm' }).success).toBe(true)
    expect(DevEnvCreateParams.safeParse({ template: 't', worktree: 'w' }).success).toBe(true)
    expect(
      DevEnvCreateParams.safeParse({ template: 't', mission: 'm', worktree: 'w' }).success
    ).toBe(false)
    expect(DevEnvCreateParams.safeParse({ template: 't' }).success).toBe(false)
  })

  it('rejects a show call without an env', () => {
    expect(getMethod('devenv.show').params?.safeParse({}).success).toBe(false)
  })

  it('resolves the env selector by key before showing', async () => {
    const show = vi.fn(async (id: string) => ({ id }))
    const operations = {
      resolveId: (selector: string) => (selector === 'kiosek' ? 'e1' : selector),
      show
    }
    const runtime = { getDevEnvOperations: () => operations }
    const method = getMethod('devenv.show')
    const result = await method.handler(method.params?.parse({ env: 'kiosek' }), {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls getDevEnvOperations().resolveId/show.
      runtime: runtime as never
    })
    expect(show).toHaveBeenCalledWith('e1')
    expect(result).toEqual({ id: 'e1' })
  })

  it('accepts only local providers or null when binding', () => {
    const params = getMethod('devenv.bind').params
    expect(params?.safeParse({ env: 'e', dependency: 'admin-api', provider: null }).success).toBe(
      true
    )
    expect(params?.safeParse({ env: 'e', dependency: 'admin-api', provider: 'e2' }).success).toBe(
      true
    )
    expect(params?.safeParse({ env: 'e', dependency: 'admin-api' }).success).toBe(false)
  })

  it('runs devenv methods on the host', () => {
    expect(getHostOperationOwnership('devenv.show')).toBe('host')
  })

  it('requires an explicit confirmation to reset data', () => {
    const params = getMethod('devenv.reset').params
    expect(params?.safeParse({ env: 'e' }).success).toBe(false)
    expect(params?.safeParse({ env: 'e', confirm: true }).success).toBe(true)
  })

  it('resolves mission and worktree selectors before creating', async () => {
    const createForMission = vi.fn(async () => ({ id: 'e1' }))
    const createForWorktree = vi.fn(async () => ({ id: 'e2' }))
    const runtime = {
      getDevEnvOperations: () => ({
        createForMission,
        createForWorktree,
        resolveId: (selector: string) => selector
      }),
      showMission: async () => ({ mission: { id: 'mission-1' } }),
      showManagedWorktree: async () => ({ id: 'repo::/w' })
    }
    const method = getMethod('devenv.create')
    await method.handler(method.params?.parse({ mission: 'Kiosek', template: 'OrderMage full' }), {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls the members stubbed here.
      runtime: runtime as never
    })
    expect(createForMission).toHaveBeenCalledWith('mission-1', 'OrderMage full')
    await method.handler(
      method.params?.parse({ worktree: 'branch:fix/x', template: 't', bindings: { geo: 'e1' } }),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls the members stubbed here.
      { runtime: runtime as never }
    )
    expect(createForWorktree).toHaveBeenCalledWith('repo::/w', 't', { geo: 'e1' })
  })

  it('never binds a remote tier over RPC', async () => {
    const runtime = {
      getDevEnvOperations: () => ({
        resolveId: (selector: string) => {
          if (selector === 'prod') {
            throw new Error('Unknown Dev Environment prod')
          }
          return selector
        },
        bind: vi.fn()
      })
    }
    const method = getMethod('devenv.bind')
    await expect(
      method.handler(
        method.params?.parse({ env: 'e1', dependency: 'admin-api', provider: 'prod' }),
        {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls the members stubbed here.
          runtime: runtime as never
        }
      )
    ).rejects.toThrow('Unknown Dev Environment prod')
  })
})
