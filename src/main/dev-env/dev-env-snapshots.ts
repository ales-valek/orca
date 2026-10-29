import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnv, DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import { fillDevEnvValues } from './dev-env-data'
import type { DevEnvInfra } from './dev-env-infra'

type SnapshotInput = {
  env: Pick<DevEnv, 'key' | 'portSlot'>
  services: DevEnvInfraService[]
  infra: Pick<DevEnvInfra, 'execToFile' | 'execFromFile'>
  dir: string
  logPath: string
}

function getDumpFile(dir: string, service: string): string {
  return join(dir, `${service}.dump`)
}

/** Dumps into a staging folder that replaces `dir` only when every dump succeeded. */
export async function snapshotDevEnvData(
  input: SnapshotInput
): Promise<{ ok: true; services: string[]; sizeBytes: number } | { ok: false; error: string }> {
  const dumpable = input.services.filter(
    (service) => service.resource?.dump && service.resource.restore
  )
  if (dumpable.length === 0) {
    return { ok: false, error: 'No infra service of this template can dump its data' }
  }
  const staging = `${input.dir}.partial`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  let sizeBytes = 0
  for (const service of dumpable) {
    const file = getDumpFile(staging, service.name)
    const result = await input.infra.execToFile(
      service.name,
      fillDevEnvValues(service.resource?.dump ?? '', input.env),
      file,
      input.logPath
    )
    if (!result.ok) {
      rmSync(staging, { recursive: true, force: true })
      return {
        ok: false,
        error: `Snapshot of ${service.name} failed (exit ${String(result.code)})`
      }
    }
    sizeBytes += statSync(file).size
  }
  // Why: Windows cannot rename over an existing folder.
  rmSync(input.dir, { recursive: true, force: true })
  renameSync(staging, input.dir)
  return { ok: true, services: dumpable.map((service) => service.name), sizeBytes }
}

/** Why a snapshot cannot be restored, checked before anything is stopped or replaced. */
export function getDevEnvRestoreProblem(input: SnapshotInput & { names: string[] }): string | null {
  for (const name of input.names) {
    const service = input.services.find((entry) => entry.name === name)
    if (!service?.resource?.restore) {
      return `${name} can no longer restore data`
    }
    if (!existsSync(getDumpFile(input.dir, name))) {
      return `Snapshot file for ${name} is missing`
    }
  }
  return null
}

export async function restoreDevEnvData(
  input: SnapshotInput & { names: string[] }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = getDevEnvRestoreProblem(input)
  if (problem) {
    return { ok: false, error: problem }
  }
  const restored: string[] = []
  for (const name of input.names) {
    const service = input.services.find((entry) => entry.name === name)
    const result = await input.infra.execFromFile(
      name,
      fillDevEnvValues(service?.resource?.restore ?? '', input.env),
      getDumpFile(input.dir, name),
      input.logPath
    )
    if (!result.ok) {
      const done = restored.length > 0 ? `; ${restored.join(', ')} already restored` : ''
      return { ok: false, error: `Restore of ${name} failed (exit ${String(result.code)})${done}` }
    }
    restored.push(name)
  }
  return { ok: true }
}
