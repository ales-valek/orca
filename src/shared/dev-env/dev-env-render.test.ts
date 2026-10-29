import { describe, expect, it } from 'vitest'
import { buildDevEnvContext, getDevEnvServiceHost, getDevEnvServiceUrl } from './dev-env-context'
import { interpolateDevEnvValue, renderDevEnvServiceCommand } from './dev-env-expression'
import { parseRenderedDevEnvFile, renderDevEnvFile } from './dev-env-file-render'
import { chooseDevEnvPortSlot, getDevEnvPort, getDevEnvPortRange } from './dev-env-ports'
import type { DevEnvInfraService, DevEnvServiceDef, DevEnvTemplate } from './dev-env-types'

const SERVICE: DevEnvServiceDef = { name: 'x', command: 'run', portOffset: 0, dependsOn: [] }

const TEMPLATE: DevEnvTemplate = {
  id: 't',
  name: 'T',
  dependencies: [],
  credentials: [],
  slots: [
    {
      name: 'admin',
      repoId: 'repo-admin',
      install: [],
      envFiles: [],
      services: [
        { ...SERVICE, name: 'admin-api', portOffset: 10, host: 'api.admin.${devEnv.key}' },
        { ...SERVICE, name: 'media', portOffset: 11 }
      ]
    },
    {
      name: 'eshop',
      repoId: 'repo-eshop',
      install: [],
      envFiles: [],
      services: [{ ...SERVICE, name: 'eshop', portOffset: 50, host: '*.eshop.${devEnv.key}' }]
    }
  ]
}

const POSTGRES: DevEnvInfraService = {
  name: 'postgres',
  ports: [{ name: 'db', host: 5432, container: 5432 }],
  environment: {},
  volumes: []
}
const MINIO: DevEnvInfraService = {
  name: 'minio',
  ports: [
    { name: 'api', host: 9001, container: 9001 },
    { name: 'ui', host: 9002, container: 9002 }
  ],
  environment: {},
  volumes: []
}

function buildContext(overrides: Partial<Parameters<typeof buildDevEnvContext>[0]> = {}) {
  return buildDevEnvContext({
    env: { key: 'kiosek', portSlot: 1 },
    template: TEMPLATE,
    infra: [POSTGRES, MINIO],
    proxyPort: 80,
    secrets: new Map([['maps-key', 's3cr3t']]),
    dependencies: new Map(),
    ...overrides
  })
}

describe('dev env ports', () => {
  it('computes ports and ranges', () => {
    expect(getDevEnvPort(1, 10)).toBe(20110)
    expect(getDevEnvPortRange(3)).toEqual({ first: 20300, last: 20399 })
  })

  it('skips used and busy slots', () => {
    expect(chooseDevEnvPortSlot(new Set([1]), (slot) => slot !== 2)).toBe(3)
    expect(chooseDevEnvPortSlot(new Set(), () => false)).toBeNull()
  })
})

describe('dev env expressions', () => {
  it('interpolates self ports with their source', () => {
    expect(
      interpolateDevEnvValue('http://127.0.0.1:${self.admin-api.port}/api', buildContext())
    ).toEqual({
      value: 'http://127.0.0.1:20110/api',
      sources: ['port'],
      secret: false
    })
  })

  it('interpolates infra ports by default and by name', () => {
    const context = buildContext()
    expect(interpolateDevEnvValue('${infra.postgres.port}', context)).toMatchObject({
      value: '5432',
      sources: ['infra']
    })
    expect(interpolateDevEnvValue('${infra.minio.port.ui}', context)).toMatchObject({
      value: '9002'
    })
    expect(interpolateDevEnvValue('${infra.minio.host}', context)).toMatchObject({
      value: '127.0.0.1'
    })
  })

  it('interpolates the env key and marks plain text as literal', () => {
    const context = buildContext()
    expect(interpolateDevEnvValue('${devEnv.key}', context)).toMatchObject({
      value: 'kiosek',
      sources: ['data']
    })
    expect(interpolateDevEnvValue('3600', context)).toEqual({
      value: '3600',
      sources: ['literal'],
      secret: false
    })
  })

  it('marks values that use a secret', () => {
    expect(interpolateDevEnvValue('key=${secret.maps-key}', buildContext())).toEqual({
      value: 'key=s3cr3t',
      sources: ['secret'],
      secret: true
    })
  })

  it('names the unresolved key', () => {
    expect(interpolateDevEnvValue('${dep.admin-api.url}/api', buildContext())).toEqual({
      error: 'Unresolved ${dep.admin-api.url}'
    })
  })

  it('resolves dependency urls and exports and keeps exported secrets masked', () => {
    const context = buildContext({
      dependencies: new Map([
        [
          'admin-api',
          { url: 'http://127.0.0.1:20210', exports: { JWT: { value: 'jwt', secret: true } } }
        ]
      ])
    })
    expect(interpolateDevEnvValue('${dep.admin-api.url}/api', context)).toMatchObject({
      value: 'http://127.0.0.1:20210/api',
      sources: ['dependency'],
      secret: false
    })
    expect(interpolateDevEnvValue('${dep.admin-api.JWT}', context)).toMatchObject({
      value: 'jwt',
      secret: true
    })
  })
})

describe('dev env service urls', () => {
  it('builds hostname URLs with the proxy port only when it is not 80', () => {
    expect(
      getDevEnvServiceUrl({ ...SERVICE, host: '*.eshop.${devEnv.key}' }, 'kiosek', 20150, 80)
    ).toBe('http://eshop.kiosek.orca.localhost')
    expect(
      getDevEnvServiceUrl({ ...SERVICE, host: 'admin.${devEnv.key}' }, 'kiosek', 20120, 8080)
    ).toBe('http://admin.kiosek.orca.localhost:8080')
    expect(getDevEnvServiceUrl({ ...SERVICE }, 'kiosek', 20112, 80)).toBe('http://127.0.0.1:20112')
  })

  it('returns the host pattern with the key filled in', () => {
    expect(getDevEnvServiceHost({ ...SERVICE, host: '*.eshop.${devEnv.key}' }, 'kiosek')).toBe(
      '*.eshop.kiosek'
    )
    expect(getDevEnvServiceHost(SERVICE, 'kiosek')).toBeNull()
  })

  it('exposes self urls and hosts in the context', () => {
    const context = buildContext()
    expect(interpolateDevEnvValue('${self.admin-api.url}', context)).toMatchObject({
      value: 'http://api.admin.kiosek.orca.localhost',
      sources: ['service']
    })
    expect(interpolateDevEnvValue('${self.media.url}', context)).toMatchObject({
      value: 'http://127.0.0.1:20111'
    })
    expect(interpolateDevEnvValue('${self.eshop.host}', context)).toMatchObject({
      value: 'eshop.kiosek.orca.localhost',
      sources: ['hostname']
    })
  })
})

describe('dev env file rendering', () => {
  const FILE = {
    path: '.env',
    base: '.env.example',
    lines: [
      { key: 'PORT', value: '${self.eshop.port}' },
      { key: 'MAPS_KEY', value: '${secret.maps-key}' }
    ]
  }
  const INPUT = {
    file: FILE,
    baseText: 'PORT=3000\nNAME="Eshop dev"\n# comment\n',
    currentText: null,
    context: buildContext(),
    envLabel: 'kiosek'
  }

  function renderOrThrow(input: Parameters<typeof renderDevEnvFile>[0]) {
    const result = renderDevEnvFile(input)
    if ('error' in result) {
      throw new Error(result.error)
    }
    return result
  }

  it('overrides base keys with dynamic lines and keeps the rest static', () => {
    const result = renderOrThrow(INPUT)
    expect(result.values.find((v) => v.key === 'PORT')).toMatchObject({
      value: '20150',
      section: 'DYNAMIC'
    })
    expect(result.values.find((v) => v.key === 'NAME')).toMatchObject({
      value: 'Eshop dev',
      section: 'STATIC'
    })
    expect(result.text).not.toContain('PORT=3000')
  })

  it('puts secret-only values in SECRET and marks them secret', () => {
    const result = renderOrThrow(INPUT)
    expect(result.values.find((v) => v.key === 'MAPS_KEY')).toEqual({
      key: 'MAPS_KEY',
      value: 's3cr3t',
      section: 'SECRET',
      sources: ['secret'],
      secret: true
    })
  })

  it('keeps the LOCAL section byte for byte on re-render', () => {
    const first = renderOrThrow(INPUT)
    const edited = `${first.text}DEBUG=1\n# keep me\n`
    const second = renderOrThrow({ ...INPUT, currentText: edited })
    expect(second.text).toContain('# --- LOCAL (kept on re-render) ---\nDEBUG=1\n# keep me\n')
    expect(second.values.find((v) => v.key === 'DEBUG')).toMatchObject({
      value: '1',
      section: 'LOCAL'
    })
  })

  it('lets a LOCAL line override a managed key and keeps an overridden secret masked', () => {
    const first = renderOrThrow({ ...INPUT, valuesText: 'API_SECRET=from-file\n' })
    const edited = `${first.text}NAME=mine\nPORT=4000\nAPI_SECRET=mine\n`
    const second = renderOrThrow({
      ...INPUT,
      valuesText: 'API_SECRET=from-file\n',
      currentText: edited
    })
    for (const key of ['NAME', 'PORT', 'API_SECRET']) {
      expect(second.values.filter((v) => v.key === key)).toHaveLength(1)
    }
    expect(second.values.find((v) => v.key === 'PORT')).toMatchObject({
      value: '4000',
      section: 'LOCAL'
    })
    expect(second.values.find((v) => v.key === 'API_SECRET')).toMatchObject({
      value: 'mine',
      section: 'LOCAL',
      secret: true
    })
    expect(second.text).not.toContain('PORT=20150')
    expect(second.text).not.toContain('API_SECRET=from-file')
  })

  it('adopts unknown keys of a pre-existing hand-written file into LOCAL', () => {
    const result = renderOrThrow({ ...INPUT, currentText: 'MY_KEY=1\nPORT=1\n' })
    expect(result.values.filter((v) => v.section === 'LOCAL').map((v) => v.key)).toEqual(['MY_KEY'])
  })

  it('fails naming the key whose value cannot be resolved', () => {
    const result = renderDevEnvFile({
      ...INPUT,
      file: { path: '.env', lines: [{ key: 'API', value: '${dep.admin-api.url}' }] }
    })
    expect(result).toEqual({ error: 'API: Unresolved ${dep.admin-api.url}' })
  })

  it('adds values from a personal values file as masked SECRET entries, template lines win', () => {
    const result = renderOrThrow({
      ...INPUT,
      valuesText:
        'PORT=1\nMAPS_KEY=from-file\nJWT_PRIVATE_KEY="-----BEGIN\nabc\n-----END"\nSMS_STRATEGY=email\n'
    })
    const byKey = (key: string) => result.values.find((value) => value.key === key)
    expect(byKey('PORT')).toMatchObject({ value: '20150', section: 'DYNAMIC' })
    expect(byKey('MAPS_KEY')).toMatchObject({ value: 's3cr3t', section: 'SECRET' })
    expect(byKey('SMS_STRATEGY')).toEqual({
      key: 'SMS_STRATEGY',
      value: 'email',
      section: 'SECRET',
      sources: ['secret'],
      secret: true
    })
    expect(byKey('JWT_PRIVATE_KEY')?.value).toBe('-----BEGIN\nabc\n-----END')
    expect(result.text).toContain('JWT_PRIVATE_KEY="-----BEGIN\nabc\n-----END"')
  })

  it('quotes values with whitespace or hashes', () => {
    const context = buildContext({ secrets: new Map([['maps-key', 'a b#c']]) })
    expect(renderOrThrow({ ...INPUT, context }).text).toContain('MAPS_KEY="a b#c"')
  })

  it('parses a rendered file back into sections', () => {
    const { text } = renderOrThrow({ ...INPUT, currentText: null })
    const parsed = parseRenderedDevEnvFile(`${text}DEBUG=1\n`)
    expect(parsed.map((v) => [v.key, v.section])).toEqual([
      ['NAME', 'STATIC'],
      ['MAPS_KEY', 'SECRET'],
      ['PORT', 'DYNAMIC'],
      ['DEBUG', 'LOCAL']
    ])
    expect(parsed.find((v) => v.key === 'MAPS_KEY')?.secret).toBe(true)
  })
})

describe('renderDevEnvServiceCommand', () => {
  it('fills ports into a service command', () => {
    expect(renderDevEnvServiceCommand('vite --port ${self.eshop.port}', buildContext())).toEqual({
      command: 'vite --port 20150'
    })
  })

  it('refuses secrets so they never reach terminal scrollback or shell history', () => {
    expect(renderDevEnvServiceCommand('run --key ${secret.maps-key}', buildContext())).toEqual({
      error: 'Service commands cannot use secrets; put them in an env file'
    })
  })

  it('names an unresolved expression', () => {
    expect(renderDevEnvServiceCommand('run ${dep.admin-api.url}', buildContext())).toEqual({
      error: 'Unresolved ${dep.admin-api.url}'
    })
  })
})
