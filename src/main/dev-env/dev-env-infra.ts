import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnvInfraService, DevEnvInfraState } from '../../shared/dev-env/dev-env-types'
import {
  describePortHolder as describeHolder,
  isPortFree as probePortFree
} from './dev-env-port-owner'
import { runDevEnvExec, type DevEnvExec } from './dev-env-shell-command'

export const DEV_ENV_COMPOSE_PROJECT = 'orca-infra'

const DOCKER_INFO_TIMEOUT_MS = 10_000
const COMPOSE_STATUS_TIMEOUT_MS = 30_000
// Why: the first `up` may pull several images.
const COMPOSE_UP_TIMEOUT_MS = 15 * 60_000
const COMPOSE_EXEC_TIMEOUT_MS = 5 * 60_000
// Why: dumps of a large database stream for a while.
const DUMP_TIMEOUT_MS = 30 * 60_000

function isNamedVolume(source: string): boolean {
  return source.length > 0 && !/[/\\.~$]/.test(source[0]) && !source.includes('/')
}

export function buildDevEnvComposeJson(services: DevEnvInfraService[]): string {
  const composeServices: Record<string, Record<string, unknown>> = {}
  const volumes: Record<string, Record<string, never>> = {}
  for (const service of services) {
    const entry: Record<string, unknown> = {
      restart: 'unless-stopped',
      ports: service.ports.map((port) => `127.0.0.1:${port.host}:${port.container}`),
      environment: service.environment,
      volumes: service.volumes
    }
    if (service.image) {
      entry.image = service.image
    }
    if (service.build) {
      entry.build = service.build
    }
    if (service.command) {
      entry.command = service.command
    }
    if (service.healthcheck) {
      entry.healthcheck = {
        test: service.healthcheck.test,
        ...(service.healthcheck.intervalSec
          ? { interval: `${service.healthcheck.intervalSec}s` }
          : {}),
        ...(service.healthcheck.retries ? { retries: service.healthcheck.retries } : {})
      }
    }
    composeServices[service.name] = entry
    for (const volume of service.volumes) {
      const source = volume.split(':')[0] ?? ''
      if (isNamedVolume(source)) {
        volumes[source] = {}
      }
    }
  }
  return `${JSON.stringify({ name: DEV_ENV_COMPOSE_PROJECT, services: composeServices, volumes }, null, 2)}\n`
}

function isMissingBinary(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export async function checkDockerAvailable(
  exec: DevEnvExec = runDevEnvExec
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await exec('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeoutMs: DOCKER_INFO_TIMEOUT_MS
    })
    return result.code === 0 && !result.timedOut
      ? { ok: true }
      : { ok: false, error: 'Docker is not running (docker info failed)' }
  } catch (error) {
    return {
      ok: false,
      error: isMissingBinary(error)
        ? 'Docker CLI not found'
        : 'Docker is not running (docker info failed)'
    }
  }
}

type ComposePsEntry = { Service?: unknown; State?: unknown; Health?: unknown }

function parseComposePs(stdout: string): ComposePsEntry[] {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return []
  }
  // Why: compose v2.21+ prints one object per line; older versions print one JSON array.
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : []
  }
  return trimmed.split('\n').flatMap((line) => {
    const parsed: unknown = JSON.parse(line)
    return typeof parsed === 'object' && parsed !== null ? [parsed] : []
  })
}

function getInfraStatus(entry: ComposePsEntry | undefined): DevEnvInfraState['status'] {
  if (!entry) {
    return 'missing'
  }
  if (entry.State !== 'running') {
    return 'stopped'
  }
  return entry.Health === 'unhealthy' ? 'unhealthy' : 'running'
}

export class DevEnvInfra {
  private readonly runExec: DevEnvExec
  private readonly isPortFree: (port: number) => Promise<boolean>
  private readonly describePortHolder: (port: number) => Promise<string>

  constructor(
    private readonly deps: {
      dir: string
      exec?: DevEnvExec
      getServices: () => DevEnvInfraService[]
      isPortFree?: (port: number) => Promise<boolean>
      describePortHolder?: (port: number) => Promise<string>
      /** Dev tools reuse this class under their own compose project and file. */
      project?: string
      buildCompose?: (services: DevEnvInfraService[]) => string
    }
  ) {
    this.runExec = deps.exec ?? runDevEnvExec
    this.isPortFree = deps.isPortFree ?? probePortFree
    this.describePortHolder =
      deps.describePortHolder ?? ((port) => describeHolder(port, this.runExec))
  }

  private composeArgs(): string[] {
    mkdirSync(this.deps.dir, { recursive: true })
    const file = join(this.deps.dir, 'compose.json')
    const buildCompose = this.deps.buildCompose ?? buildDevEnvComposeJson
    writeFileSync(file, buildCompose(this.deps.getServices()))
    return ['compose', '-p', this.deps.project ?? DEV_ENV_COMPOSE_PROJECT, '-f', file]
  }

  async getStatus(): Promise<DevEnvInfraState[] | { error: string }> {
    const services = this.deps.getServices()
    if (services.length === 0) {
      return []
    }
    let entries: ComposePsEntry[]
    try {
      const result = await this.runExec(
        'docker',
        [...this.composeArgs(), 'ps', '--all', '--format', 'json'],
        {
          timeoutMs: COMPOSE_STATUS_TIMEOUT_MS
        }
      )
      if (result.code !== 0) {
        const docker = await checkDockerAvailable(this.runExec)
        return { error: docker.ok ? 'docker compose ps failed' : docker.error }
      }
      entries = parseComposePs(result.stdout)
    } catch (error) {
      return { error: isMissingBinary(error) ? 'Docker CLI not found' : String(error) }
    }
    return services.map((service) => ({
      name: service.name,
      status: getInfraStatus(entries.find((entry) => entry.Service === service.name)),
      ports: service.ports.map((port) => port.host)
    }))
  }

  /** Starts the named services that are missing or stopped; leaves running containers alone. */
  async ensure(
    names: string[],
    logPath: string
  ): Promise<{ ok: true; started: string[] } | { ok: false; error: string }> {
    const services = this.deps.getServices()
    const unknown = names.find((name) => !services.some((service) => service.name === name))
    if (unknown) {
      return { ok: false, error: `Unknown infra service "${unknown}"` }
    }
    if (names.length === 0) {
      return { ok: true, started: [] }
    }
    const docker = await checkDockerAvailable(this.runExec)
    if (!docker.ok) {
      return docker
    }
    const status = await this.getStatus()
    if ('error' in status) {
      return { ok: false, error: status.error }
    }
    const toStart = names.filter(
      (name) => status.find((entry) => entry.name === name)?.status !== 'running'
    )
    for (const name of toStart) {
      for (const port of services.find((service) => service.name === name)?.ports ?? []) {
        if (!(await this.isPortFree(port.host))) {
          const holder = await this.describePortHolder(port.host)
          return {
            ok: false,
            error: `Port ${port.host} is held by ${holder}. Orca did not start ${name}.`
          }
        }
      }
    }
    if (toStart.length === 0) {
      return { ok: true, started: [] }
    }
    const result = await this.runExec(
      'docker',
      [
        ...this.composeArgs(),
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '300',
        '--no-recreate',
        ...toStart
      ],
      {
        timeoutMs: COMPOSE_UP_TIMEOUT_MS,
        logPath
      }
    )
    return result.code === 0 && !result.timedOut
      ? { ok: true, started: toStart }
      : {
          ok: false,
          error: `docker compose up failed (exit ${String(result.code)}); see the infra log`
        }
  }

  async stop(name: string, logPath: string): Promise<boolean> {
    const result = await this.runExec('docker', [...this.composeArgs(), 'stop', name], {
      timeoutMs: COMPOSE_STATUS_TIMEOUT_MS,
      logPath
    })
    return result.code === 0
  }

  async down(logPath: string): Promise<boolean> {
    const result = await this.runExec('docker', [...this.composeArgs(), 'down'], {
      timeoutMs: COMPOSE_UP_TIMEOUT_MS,
      logPath
    })
    return result.code === 0
  }

  exec(
    service: string,
    shell: string,
    logPath: string
  ): Promise<{ ok: boolean; code: number | null }> {
    return this.runInService(service, shell, { timeoutMs: COMPOSE_EXEC_TIMEOUT_MS, logPath })
  }

  execToFile(
    service: string,
    shell: string,
    stdoutPath: string,
    logPath: string
  ): Promise<{ ok: boolean; code: number | null }> {
    return this.runInService(service, shell, { timeoutMs: DUMP_TIMEOUT_MS, logPath, stdoutPath })
  }

  execFromFile(
    service: string,
    shell: string,
    stdinPath: string,
    logPath: string
  ): Promise<{ ok: boolean; code: number | null }> {
    return this.runInService(service, shell, { timeoutMs: DUMP_TIMEOUT_MS, logPath, stdinPath })
  }

  private async runInService(
    service: string,
    shell: string,
    opts: Parameters<DevEnvExec>[2]
  ): Promise<{ ok: boolean; code: number | null }> {
    const result = await this.runExec(
      'docker',
      [...this.composeArgs(), 'exec', '-T', service, 'sh', '-c', shell],
      opts
    )
    return { ok: result.code === 0 && !result.timedOut, code: result.code }
  }
}
