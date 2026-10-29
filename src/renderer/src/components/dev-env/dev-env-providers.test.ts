import { describe, expect, it } from 'vitest'
import { splitDevEnvBindings } from './dev-env-providers'

describe('splitDevEnvBindings', () => {
  it('keeps local providers for create and lists remote tiers to bind afterwards', () => {
    expect(splitDevEnvBindings({ 'admin-api': 'remote:dev', geo: 'env-1' })).toEqual({
      local: { geo: 'env-1' },
      remote: [{ dependency: 'admin-api', tierId: 'dev' }]
    })
  })
})
