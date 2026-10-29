import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import type { DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import { dropDevEnvData, provisionDevEnvData } from './dev-env-data'
import { DevEnvSecretStore } from './dev-env-secret-store'

const POSTGRES: DevEnvInfraService = {
  name: 'postgres',
  ports: [],
  environment: {},
  volumes: [],
  resource: { create: 'createdb ${devEnv.key}', drop: 'dropdb ${devEnv.key}' }
}
const MINIO: DevEnvInfraService = {
  name: 'minio',
  ports: [],
  environment: {},
  volumes: [],
  resource: {
    create: 'mc mb local/${devEnv.key}-${devEnv.slot}',
    drop: 'mc rb local/${devEnv.key}'
  }
}
const REDIS: DevEnvInfraService = { name: 'redis', ports: [], environment: {}, volumes: [] }

function createFakeInfra(failOn?: string) {
  const calls: { service: string; shell: string }[] = []
  return {
    calls,
    infra: {
      exec: async (service: string, shell: string) => {
        calls.push({ service, shell })
        return service === failOn ? { ok: false, code: 2 } : { ok: true, code: 0 }
      }
    }
  }
}

describe('provisionDevEnvData', () => {
  it('runs each resource create command with the env key and slot, in order', async () => {
    const { infra, calls } = createFakeInfra()
    const result = await provisionDevEnvData({
      env: { key: 'kiosek', portSlot: 3 },
      services: [POSTGRES, REDIS, MINIO],
      infra,
      logPath: '/tmp/x.log'
    })
    expect(result).toEqual({ ok: true, created: ['postgres', 'minio'] })
    expect(calls).toEqual([
      { service: 'postgres', shell: 'createdb kiosek' },
      { service: 'minio', shell: 'mc mb local/kiosek-3' }
    ])
  })

  it('stops at the first failure and names the service', async () => {
    const { infra, calls } = createFakeInfra('postgres')
    expect(
      await provisionDevEnvData({
        env: { key: 'k', portSlot: 1 },
        services: [POSTGRES, MINIO],
        infra,
        logPath: '/tmp/x.log'
      })
    ).toEqual({ ok: false, error: 'Data for postgres failed (exit 2)' })
    expect(calls).toHaveLength(1)
  })

  it('runs drop commands', async () => {
    const { infra, calls } = createFakeInfra()
    await dropDevEnvData({
      env: { key: 'k', portSlot: 1 },
      services: [POSTGRES],
      infra,
      logPath: '/tmp/x.log'
    })
    expect(calls).toEqual([{ service: 'postgres', shell: 'dropdb k' }])
  })
})

describe('DevEnvSecretStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-dev-env-secrets-'))
    setSecretStore({
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
      decryptString: (cipher) => cipher.toString('utf8').replace(/^enc:/, ''),
      describeProtectionGap: () => null
    })
  })

  afterEach(() => {
    _resetSecretStoreForTests()
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips secrets encrypted at rest and lists names only', () => {
    const store = new DevEnvSecretStore(dir)
    store.set('maps-key', 'abc123')
    expect(store.get('maps-key')).toBe('abc123')
    expect(store.list()).toEqual(['maps-key'])
    expect(store.getAll()).toEqual(new Map([['maps-key', 'abc123']]))
    const [file] = readdirSync(dir)
    expect(readFileSync(join(dir, file), 'utf8')).toBe('enc:abc123')
  })

  it('deletes secrets', () => {
    const store = new DevEnvSecretStore(dir)
    store.set('a', '1')
    expect(store.delete('a')).toBe(true)
    expect(store.delete('a')).toBe(false)
    expect(store.get('a')).toBeNull()
  })

  it('rejects names that could escape the directory', () => {
    const store = new DevEnvSecretStore(dir)
    expect(() => store.set('../x', '1')).toThrow('Invalid secret name')
    expect(() => store.set('UPPER', '1')).toThrow('Invalid secret name')
  })
})
