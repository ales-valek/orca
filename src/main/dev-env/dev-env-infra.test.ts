import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import { buildDevEnvComposeJson, checkDockerAvailable, DevEnvInfra } from './dev-env-infra'
import { describePortHolder } from './dev-env-port-owner'
import { runDevEnvExec, runDevEnvShellCommand, type DevEnvExec } from './dev-env-shell-command'

const POSTGRES: DevEnvInfraService = {
  name: 'postgres',
  image: 'postgis/postgis:17-3.5',
  ports: [{ name: 'db', host: 5432, container: 5432 }],
  environment: { POSTGRES_PASSWORD: 'postgres_password' },
  volumes: ['postgres:/var/lib/postgresql/data', './init:/docker-entrypoint-initdb.d:ro'],
  healthcheck: { test: ['CMD-SHELL', 'pg_isready'], intervalSec: 5, retries: 30 }
}
const REDIS: DevEnvInfraService = {
  name: 'redis',
  image: 'redis:7-alpine',
  ports: [{ name: 'redis', host: 6379, container: 6379 }],
  environment: {},
  volumes: []
}

type Call = { program: string; args: string[]; logPath?: string }

function createFakeExec(
  respond: (call: Call) => { code: number | null; stdout?: string } | 'enoent'
): { exec: DevEnvExec; calls: Call[] } {
  const calls: Call[] = []
  const exec: DevEnvExec = async (program, args, opts) => {
    const call = { program, args, logPath: opts.logPath }
    calls.push(call)
    const result = respond(call)
    if (result === 'enoent') {
      throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' })
    }
    return { code: result.code, stdout: result.stdout ?? '', stderr: '', timedOut: false }
  }
  return { exec, calls }
}

const isDockerInfo = (call: Call): boolean => call.args[0] === 'info'
const isComposePs = (call: Call): boolean => call.args.includes('ps') && call.args.includes('--all')

describe('buildDevEnvComposeJson', () => {
  it('builds loopback ports, named volumes and healthchecks', () => {
    const json = JSON.parse(buildDevEnvComposeJson([POSTGRES]))
    expect(json.services.postgres).toMatchObject({
      image: 'postgis/postgis:17-3.5',
      ports: ['127.0.0.1:5432:5432'],
      environment: { POSTGRES_PASSWORD: 'postgres_password' },
      restart: 'unless-stopped',
      healthcheck: { test: ['CMD-SHELL', 'pg_isready'], interval: '5s', retries: 30 }
    })
    expect(json.volumes).toEqual({ postgres: {} })
  })
})

describe('DevEnvInfra', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-dev-env-infra-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function createInfra(
    exec: DevEnvExec,
    isPortFree: (port: number) => Promise<boolean> = async () => true
  ) {
    return new DevEnvInfra({
      dir,
      exec,
      getServices: () => [POSTGRES, REDIS],
      isPortFree,
      describePortHolder: (port) => describePortHolder(port, exec, async () => [])
    })
  }

  it('parses compose ps output into states including missing services', async () => {
    const { exec } = createFakeExec((call) =>
      isComposePs(call)
        ? { code: 0, stdout: '{"Service":"postgres","State":"running","Health":"healthy"}\n' }
        : { code: 0 }
    )
    expect(await createInfra(exec).getStatus()).toEqual([
      { name: 'postgres', status: 'running', ports: [5432] },
      { name: 'redis', status: 'missing', ports: [6379] }
    ])
  })

  it('accepts the JSON array output of older compose versions', async () => {
    const { exec } = createFakeExec((call) =>
      isComposePs(call)
        ? {
            code: 0,
            stdout:
              '[{"Service":"redis","State":"exited"},{"Service":"postgres","State":"running","Health":"unhealthy"}]'
          }
        : { code: 0 }
    )
    expect(await createInfra(exec).getStatus()).toEqual([
      { name: 'postgres', status: 'unhealthy', ports: [5432] },
      { name: 'redis', status: 'stopped', ports: [6379] }
    ])
  })

  it('writes the compose file and runs up -d --no-recreate for missing services', async () => {
    const { exec, calls } = createFakeExec(() => ({ code: 0, stdout: '' }))
    expect(await createInfra(exec).ensure(['postgres'], join(dir, 'infra.log'))).toEqual({
      ok: true,
      started: ['postgres']
    })
    const up = calls.find((call) => call.args.includes('up'))
    expect(up?.args).toEqual([
      'compose',
      '-p',
      'orca-infra',
      '-f',
      join(dir, 'compose.json'),
      'up',
      '-d',
      '--no-recreate',
      'postgres'
    ])
    expect(up?.logPath).toBe(join(dir, 'infra.log'))
    expect(JSON.parse(readFileSync(join(dir, 'compose.json'), 'utf8')).services.redis).toBeDefined()
  })

  it('does not call up when everything is already running', async () => {
    const { exec, calls } = createFakeExec((call) =>
      isComposePs(call)
        ? { code: 0, stdout: '{"Service":"postgres","State":"running"}' }
        : { code: 0 }
    )
    expect(await createInfra(exec).ensure(['postgres'], join(dir, 'infra.log'))).toEqual({
      ok: true,
      started: []
    })
    expect(calls.some((call) => call.args.includes('up'))).toBe(false)
  })

  it('fails ensure when docker is not running and does not call up', async () => {
    const { exec, calls } = createFakeExec((call) =>
      isDockerInfo(call) ? { code: 1 } : { code: 0 }
    )
    expect(await createInfra(exec).ensure(['postgres'], join(dir, 'infra.log'))).toEqual({
      ok: false,
      error: 'Docker is not running (docker info failed)'
    })
    expect(calls.some((call) => call.args.includes('up'))).toBe(false)
  })

  it('names a foreign container holding a needed port and does not start', async () => {
    const { exec, calls } = createFakeExec((call) =>
      call.args[0] === 'ps' && call.args.includes('publish=6379')
        ? { code: 0, stdout: 'ordermage-eshop-redis (ordermage-eshop)\n' }
        : { code: 0, stdout: '' }
    )
    const infra = createInfra(exec, async (port) => port !== 6379)
    expect(await infra.ensure(['redis'], join(dir, 'infra.log'))).toEqual({
      ok: false,
      error:
        'Port 6379 is held by container ordermage-eshop-redis (compose ordermage-eshop). Orca did not start redis.'
    })
    expect(calls.some((call) => call.args.includes('up'))).toBe(false)
  })

  it('rejects an infra name that is not configured', async () => {
    const { exec } = createFakeExec(() => ({ code: 0, stdout: '' }))
    expect(await createInfra(exec).ensure(['mongo'], join(dir, 'infra.log'))).toEqual({
      ok: false,
      error: 'Unknown infra service "mongo"'
    })
  })
})

describe('checkDockerAvailable', () => {
  it('reports a missing docker binary', async () => {
    const { exec } = createFakeExec(() => 'enoent')
    expect(await checkDockerAvailable(exec)).toEqual({ ok: false, error: 'Docker CLI not found' })
  })
})

describe('describePortHolder', () => {
  it('falls back to the listening process, then to an unknown process', async () => {
    const { exec } = createFakeExec(() => ({ code: 0, stdout: '' }))
    expect(
      await describePortHolder(3000, exec, async () => [
        { host: '127.0.0.1', port: 3000, pid: 42, processName: 'node' }
      ])
    ).toBe('pid 42 node')
    expect(await describePortHolder(3000, exec, async () => [])).toBe('an unknown process')
  })
})

describe('runDevEnvShellCommand', () => {
  it('runs a shell string and appends its output to the log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-dev-env-shell-'))
    try {
      const logPath = join(dir, 'install.log')
      const result = await runDevEnvShellCommand(
        'echo hello-dev-env',
        { cwd: dir, logPath, timeoutMs: 10_000 },
        runDevEnvExec
      )
      expect(result).toEqual({ ok: true, code: 0, timedOut: false })
      expect(readFileSync(logPath, 'utf8')).toContain('hello-dev-env')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
