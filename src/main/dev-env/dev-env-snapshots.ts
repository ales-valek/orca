import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnv, DevEnvInfraService } from '../../shared/dev-env/dev-env-types'

type FileExecResult = { ok: boolean; code: number | null }

export type DevEnvSnapshotInfra = {
  execToFile(
    service: string,
    shell: string,
    stdoutPath: string,
    logPath: string
  ): Promise<FileExecResult>
  execFromFile(
    service: string,
    shell: string,
    stdinPath: string,
    logPath: string
  ): Promise<FileExecResult>
}

type SnapshotInput = {
  env: Pick<DevEnv, 'key' | 'portSlot'>
  services: DevEnvInfraService[]
  infra: DevEnvSnapshotInfra
  dir: string
  logPath: string
}

function fillDevEnvValues(command: string, env: Pick<DevEnv, 'key' | 'portSlot'>): string {
  return command
    .split('${devEnv.key}')
    .join(env.key)
    .split('${devEnv.slot}')
    .join(String(env.portSlot))
}

function getDumpFile(dir: string, service: string): string {
  return join(dir, `${service}.dump`)
}

/** Dumps this environment's resources into `<dir>/<service>.dump`; an existing snapshot is overwritten. */
export async function snapshotDevEnvData(
  input: SnapshotInput
): Promise<{ ok: true; services: string[]; sizeBytes: number } | { ok: false; error: string }> {
  const dumpable = input.services.filter(
    (service) => service.resource?.dump && service.resource.restore
  )
  if (dumpable.length === 0) {
    return { ok: false, error: 'No infra service of this template can dump its data' }
  }
  mkdirSync(input.dir, { recursive: true })
  let sizeBytes = 0
  for (const service of dumpable) {
    const file = getDumpFile(input.dir, service.name)
    const result = await input.infra.execToFile(
      service.name,
      fillDevEnvValues(service.resource?.dump ?? '', input.env),
      file,
      input.logPath
    )
    if (!result.ok) {
      return {
        ok: false,
        error: `Snapshot of ${service.name} failed (exit ${String(result.code)})`
      }
    }
    sizeBytes += statSync(file).size
  }
  return { ok: true, services: dumpable.map((service) => service.name), sizeBytes }
}

export async function restoreDevEnvData(
  input: SnapshotInput & { names: string[] }
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const name of input.names) {
    const service = input.services.find((entry) => entry.name === name)
    const file = getDumpFile(input.dir, name)
    if (!service?.resource?.restore) {
      return { ok: false, error: `${name} can no longer restore data` }
    }
    if (!existsSync(file)) {
      return { ok: false, error: `Snapshot file for ${name} is missing` }
    }
    const result = await input.infra.execFromFile(
      name,
      fillDevEnvValues(service.resource.restore, input.env),
      file,
      input.logPath
    )
    if (!result.ok) {
      return { ok: false, error: `Restore of ${name} failed (exit ${String(result.code)})` }
    }
  }
  return { ok: true }
}
