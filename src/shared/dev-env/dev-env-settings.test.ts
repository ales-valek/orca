import { describe, expect, it } from 'vitest'
import {
  getDefaultDevEnvProxyPort,
  normalizeDevEnvSettings,
  normalizeDevEnvSettingsUpdate,
  parseDevEnvTemplateJson,
  serializeDevEnvTemplate
} from './dev-env-settings'
import type { DevEnvTemplate } from './dev-env-types'

const TEMPLATE: DevEnvTemplate = {
  id: 't1',
  name: 'Eshop only',
  slots: [
    {
      name: 'eshop',
      repoId: 'repo-eshop',
      install: ['npm ci'],
      envFiles: [
        {
          path: '.env',
          base: '.env.example',
          valuesFile: '~/.config/ordermage-mission/secrets/eshop/.env',
          lines: [{ key: 'PORT', value: '${self.eshop.port}' }]
        }
      ],
      services: [
        {
          name: 'eshop',
          prod: { build: 'npm run build', start: 'npm start' },
          command: 'npm run dev',
          portOffset: 50,
          host: '*.eshop.${devEnv.key}',
          dependsOn: ['redis'],
          ready: { httpPath: '/' },
          exports: { BASE: '${self.eshop.url}' }
        }
      ]
    }
  ],
  dependencies: ['admin-api'],
  seed: { slot: 'eshop', command: 'npm run seed', enabledByDefault: false },
  credentials: [
    { label: 'Customer', userKey: 'secret.customer-user', passwordKey: 'secret.customer-pass' }
  ]
}

describe('dev env settings', () => {
  it('defaults the proxy port by platform', () => {
    expect(getDefaultDevEnvProxyPort('darwin')).toBe(80)
    expect(getDefaultDevEnvProxyPort('win32')).toBe(80)
    expect(getDefaultDevEnvProxyPort('linux')).toBe(8080)
  })

  it('fills defaults for missing settings', () => {
    expect(normalizeDevEnvSettings(undefined, 'linux')).toEqual({
      devEnvInfra: [],
      devEnvRemoteTiers: [],
      devEnvTemplates: [],
      devEnvProxyPort: 8080
    })
  })

  it('drops templates without id or name and services with an out-of-range offset', () => {
    const settings = normalizeDevEnvSettings(
      {
        devEnvTemplates: [
          {
            id: 't',
            name: 'T',
            slots: [
              {
                name: 'admin',
                repoId: 'r',
                install: [],
                envFiles: [],
                services: [
                  { name: 'api', command: 'x', portOffset: 10, dependsOn: [] },
                  { name: 'bad', command: 'x', portOffset: 100, dependsOn: [] },
                  { name: 'frac', command: 'x', portOffset: 1.5, dependsOn: [] }
                ]
              }
            ],
            dependencies: [],
            credentials: []
          },
          { name: 'no id' }
        ]
      },
      'darwin'
    )
    expect(settings.devEnvTemplates).toHaveLength(1)
    expect(settings.devEnvTemplates[0].slots[0].services.map((s) => s.name)).toEqual(['api'])
  })

  it('drops infra services without a name or with invalid ports', () => {
    const settings = normalizeDevEnvSettings(
      {
        devEnvInfra: [
          {
            name: 'postgres',
            image: 'postgis/postgis:17-3.5',
            ports: [
              { name: 'db', host: 5432, container: 5432 },
              { name: 'x', host: 70000, container: 1 }
            ],
            environment: { POSTGRES_PASSWORD: 'p' },
            volumes: ['postgres:/var/lib/postgresql/data'],
            resource: { create: 'createdb ${devEnv.key}', drop: 'dropdb ${devEnv.key}' }
          },
          { image: 'redis' }
        ]
      },
      'darwin'
    )
    expect(settings.devEnvInfra).toEqual([
      {
        name: 'postgres',
        image: 'postgis/postgis:17-3.5',
        ports: [{ name: 'db', host: 5432, container: 5432 }],
        environment: { POSTGRES_PASSWORD: 'p' },
        volumes: ['postgres:/var/lib/postgresql/data'],
        resource: { create: 'createdb ${devEnv.key}', drop: 'dropdb ${devEnv.key}' }
      }
    ])
  })

  it('keeps a valid proxy port and replaces an invalid one with the default', () => {
    expect(normalizeDevEnvSettings({ devEnvProxyPort: 8081 }, 'darwin').devEnvProxyPort).toBe(8081)
    expect(normalizeDevEnvSettings({ devEnvProxyPort: 0 }, 'darwin').devEnvProxyPort).toBe(80)
  })

  it('normalizes only the keys present in an update', () => {
    expect(normalizeDevEnvSettingsUpdate({ devEnvProxyPort: 9090 })).toEqual({
      devEnvProxyPort: 9090
    })
    expect(normalizeDevEnvSettingsUpdate({})).toEqual({})
  })

  it('rejects duplicate service names across slots of one template', () => {
    const result = parseDevEnvTemplateJson(
      JSON.stringify({
        id: 't',
        name: 'T',
        dependencies: [],
        credentials: [],
        slots: [
          {
            name: 'a',
            repoId: null,
            install: [],
            envFiles: [],
            services: [{ name: 'x', command: 'c', portOffset: 1, dependsOn: [] }]
          },
          {
            name: 'b',
            repoId: null,
            install: [],
            envFiles: [],
            services: [{ name: 'x', command: 'c', portOffset: 2, dependsOn: [] }]
          }
        ]
      })
    )
    expect(result).toEqual({ error: 'Duplicate service name "x"' })
  })

  it('round-trips a template through JSON', () => {
    expect(parseDevEnvTemplateJson(serializeDevEnvTemplate(TEMPLATE))).toEqual({
      template: TEMPLATE
    })
  })

  it('reports invalid JSON', () => {
    expect(parseDevEnvTemplateJson('{')).toEqual({ error: expect.stringMatching(/^Invalid JSON/) })
  })

  it('reports a JSON value that is not a template', () => {
    expect(parseDevEnvTemplateJson('{"name":"x"}')).toEqual({
      error: 'Not a Dev Environment template'
    })
  })

  it('keeps valid remote tiers and drops invalid ones', () => {
    const settings = normalizeDevEnvSettings(
      {
        devEnvRemoteTiers: [
          {
            id: 'staging',
            name: 'Staging',
            danger: false,
            dependencies: {
              'admin-api': {
                url: 'https://api.staging',
                values: { API_KEY: '${secret.staging-key}' }
              },
              broken: { values: {} }
            }
          },
          { id: 'prod', name: 'Prod', danger: true, dependencies: {} },
          { name: 'no id' }
        ]
      },
      'darwin'
    )
    expect(settings.devEnvRemoteTiers).toEqual([
      {
        id: 'staging',
        name: 'Staging',
        danger: false,
        dependencies: {
          'admin-api': { url: 'https://api.staging', values: { API_KEY: '${secret.staging-key}' } }
        }
      },
      { id: 'prod', name: 'Prod', danger: true, dependencies: {} }
    ])
  })

  it('keeps infra dump and restore commands', () => {
    const [service] = normalizeDevEnvSettings(
      {
        devEnvInfra: [
          {
            name: 'postgres',
            ports: [],
            environment: {},
            volumes: [],
            resource: { create: 'c', drop: 'd', dump: 'pg_dump', restore: 'pg_restore' }
          }
        ]
      },
      'darwin'
    ).devEnvInfra
    expect(service.resource).toEqual({
      create: 'c',
      drop: 'd',
      dump: 'pg_dump',
      restore: 'pg_restore'
    })
  })
})
