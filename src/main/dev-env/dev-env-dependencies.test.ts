import { describe, expect, it } from 'vitest'
import { buildDevEnvContext } from '../../shared/dev-env/dev-env-context'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import type { DevEnv, DevEnvTemplate } from '../../shared/dev-env/dev-env-types'
import { getDevEnvDependencyStates, resolveDevEnvDependencies } from './dev-env-dependencies'

const TEMPLATE: DevEnvTemplate = {
  id: 't',
  name: 'Eshop only',
  dependencies: ['admin-api'],
  credentials: [],
  slots: [
    {
      name: 'eshop',
      repoId: 'r',
      install: [],
      envFiles: [],
      services: [{ name: 'eshop', command: 'dev', portOffset: 50, dependsOn: [] }]
    }
  ]
}

const SETTINGS: DevEnvGlobalSettings = {
  devEnvInfra: [],
  devEnvTemplates: [TEMPLATE],
  devEnvProxyPort: 80,
  devEnvRemoteTiers: [
    {
      id: 'staging',
      name: 'Staging',
      danger: false,
      dependencies: {
        'admin-api': {
          url: 'https://api.admin.staging.example',
          values: { API_KEY: '${secret.staging-key}', REGION: 'eu' }
        }
      }
    }
  ]
}

function env(binding: DevEnv['bindings'][string]): DevEnv {
  return {
    id: 'e1',
    key: 'fix',
    name: 'fix',
    templateId: 't',
    attachment: { kind: 'worktree', worktreeId: 'w' },
    portSlot: 1,
    slotPins: {},
    slotWorktrees: { eshop: { worktreeId: 'w', path: '/w', label: 'eshop' } },
    bindings: { 'admin-api': binding },
    setup: {},
    createdAt: 1
  }
}

const lookup = {
  getDevEnv: () => null,
  getSettings: () => SETTINGS,
  secrets: new Map([['staging-key', 'k-123']])
}

describe('remote tier dependencies', () => {
  it('resolves a remote tier url and values, keeping secret values masked', () => {
    const resolved = resolveDevEnvDependencies(
      env({ kind: 'remote', tierId: 'staging' }),
      TEMPLATE,
      lookup
    )
    expect(resolved.get('admin-api')).toEqual({
      url: 'https://api.admin.staging.example',
      urlSecret: false,
      exports: { API_KEY: { value: 'k-123', secret: true }, REGION: { value: 'eu', secret: false } }
    })
  })

  it('masks a tier url that embeds a secret', () => {
    const tier = SETTINGS.devEnvRemoteTiers[0]
    const withSecretUrl: DevEnvGlobalSettings = {
      ...SETTINGS,
      devEnvRemoteTiers: [
        {
          ...tier,
          dependencies: { 'admin-api': { url: 'https://${secret.staging-key}@api', values: {} } }
        }
      ]
    }
    const dependencies = resolveDevEnvDependencies(
      env({ kind: 'remote', tierId: 'staging' }),
      TEMPLATE,
      {
        ...lookup,
        getSettings: () => withSecretUrl
      }
    )
    const context = buildDevEnvContext({
      env: env({ kind: 'remote', tierId: 'staging' }),
      template: TEMPLATE,
      infra: [],
      proxyPort: 80,
      secrets: new Map(),
      dependencies
    })
    expect(context.get('dep.admin-api.url')?.secret).toBe(true)
  })

  it('reports remote and missing tiers', async () => {
    const states = (binding: DevEnv['bindings'][string]) =>
      getDevEnvDependencyStates(env(binding), TEMPLATE, lookup, async () => [])
    expect(await states({ kind: 'remote', tierId: 'staging' })).toEqual({ 'admin-api': 'remote' })
    expect(await states({ kind: 'remote', tierId: 'gone' })).toEqual({ 'admin-api': 'missing' })
    expect(
      resolveDevEnvDependencies(env({ kind: 'remote', tierId: 'gone' }), TEMPLATE, lookup).size
    ).toBe(0)
  })
})
