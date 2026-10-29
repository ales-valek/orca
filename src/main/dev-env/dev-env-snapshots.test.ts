import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import { restoreDevEnvData, snapshotDevEnvData } from './dev-env-snapshots'

const POSTGRES: DevEnvInfraService = {
  name: 'postgres',
  ports: [],
  environment: {},
  volumes: [],
  resource: {
    create: 'c',
    drop: 'd',
    dump: 'pg_dump ${devEnv.key}',
    restore: 'pg_restore -d ${devEnv.key}'
  }
}
const REDIS: DevEnvInfraService = { name: 'redis', ports: [], environment: {}, volumes: [] }

describe('dev env snapshots', () => {
  let dir: string
  let calls: { kind: string; service: string; shell: string; path: string }[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-dev-env-snapshot-'))
    calls = []
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const infra = (failOn?: string) => ({
    execToFile: async (service: string, shell: string, path: string) => {
      calls.push({ kind: 'dump', service, shell, path })
      writeFileSync(path, 'rows')
      return service === failOn ? { ok: false, code: 2 } : { ok: true, code: 0 }
    },
    execFromFile: async (service: string, shell: string, path: string) => {
      calls.push({ kind: 'restore', service, shell, path })
      return service === failOn ? { ok: false, code: 3 } : { ok: true, code: 0 }
    }
  })

  it('dumps every dumpable service into the snapshot folder and sums the size', async () => {
    const result = await snapshotDevEnvData({
      env: { key: 'kiosek', portSlot: 1 },
      services: [POSTGRES, REDIS],
      infra: infra(),
      dir: join(dir, 'wave2'),
      logPath: join(dir, 'log')
    })
    expect(result).toEqual({ ok: true, services: ['postgres'], sizeBytes: 4 })
    expect(calls).toEqual([
      {
        kind: 'dump',
        service: 'postgres',
        shell: 'pg_dump kiosek',
        path: join(dir, 'wave2.partial', 'postgres.dump')
      }
    ])
    expect(readFileSync(join(dir, 'wave2', 'postgres.dump'), 'utf8')).toBe('rows')
  })

  it('fails when no service can dump, or names the failing service', async () => {
    expect(
      await snapshotDevEnvData({
        env: { key: 'k', portSlot: 1 },
        services: [REDIS],
        infra: infra(),
        dir,
        logPath: join(dir, 'log')
      })
    ).toEqual({ ok: false, error: 'No infra service of this template can dump its data' })
    expect(
      await snapshotDevEnvData({
        env: { key: 'k', portSlot: 1 },
        services: [POSTGRES],
        infra: infra('postgres'),
        dir: join(dir, 's'),
        logPath: join(dir, 'log')
      })
    ).toEqual({ ok: false, error: 'Snapshot of postgres failed (exit 2)' })
  })

  it('keeps the previous snapshot intact when overwriting it fails', async () => {
    const input = {
      env: { key: 'k', portSlot: 1 },
      services: [POSTGRES],
      dir: join(dir, 'wave2'),
      logPath: join(dir, 'log')
    }
    await snapshotDevEnvData({ ...input, infra: infra() })
    writeFileSync(join(dir, 'wave2', 'postgres.dump'), 'old rows')
    await snapshotDevEnvData({ ...input, infra: infra('postgres') })
    expect(readFileSync(join(dir, 'wave2', 'postgres.dump'), 'utf8')).toBe('old rows')
    expect(existsSync(join(dir, 'wave2.partial'))).toBe(false)
  })

  it('restores each recorded service from its file and refuses a missing file', async () => {
    const snapshotDir = join(dir, 'wave2')
    await snapshotDevEnvData({
      env: { key: 'k', portSlot: 1 },
      services: [POSTGRES],
      infra: infra(),
      dir: snapshotDir,
      logPath: join(dir, 'log')
    })
    calls = []
    expect(
      await restoreDevEnvData({
        env: { key: 'k', portSlot: 1 },
        services: [POSTGRES],
        names: ['postgres'],
        infra: infra(),
        dir: snapshotDir,
        logPath: join(dir, 'log')
      })
    ).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        kind: 'restore',
        service: 'postgres',
        shell: 'pg_restore -d k',
        path: join(snapshotDir, 'postgres.dump')
      }
    ])
    calls = []
    expect(
      await restoreDevEnvData({
        env: { key: 'k', portSlot: 1 },
        services: [POSTGRES, REDIS],
        names: ['postgres', 'redis'],
        infra: infra(),
        dir: snapshotDir,
        logPath: join(dir, 'log')
      })
    ).toEqual({ ok: false, error: 'redis can no longer restore data' })
    expect(calls).toEqual([])
    rmSync(join(snapshotDir, 'postgres.dump'))
    expect(existsSync(join(snapshotDir, 'postgres.dump'))).toBe(false)
    expect(
      await restoreDevEnvData({
        env: { key: 'k', portSlot: 1 },
        services: [POSTGRES],
        names: ['postgres'],
        infra: infra(),
        dir: snapshotDir,
        logPath: join(dir, 'log')
      })
    ).toEqual({ ok: false, error: 'Snapshot file for postgres is missing' })
  })
})
