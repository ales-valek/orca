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
    // SAFETY: the handler only calls getDevEnvOperations().resolveId/show.
    const result = await method.handler(method.params?.parse({ env: 'kiosek' }), {
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
})
