import type { DevEnv, DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import type { DevEnvInfra } from './dev-env-infra'

type DevEnvDataInput = {
  env: Pick<DevEnv, 'key' | 'portSlot'>
  services: DevEnvInfraService[]
  infra: Pick<DevEnvInfra, 'exec'>
  logPath: string
}

export function fillDevEnvValues(command: string, env: Pick<DevEnv, 'key' | 'portSlot'>): string {
  return command
    .split('${devEnv.key}')
    .join(env.key)
    .split('${devEnv.slot}')
    .join(String(env.portSlot))
}

async function runResourceCommands(
  input: DevEnvDataInput,
  pick: (resource: NonNullable<DevEnvInfraService['resource']>) => string
): Promise<{ ok: true; created: string[] } | { ok: false; error: string }> {
  const created: string[] = []
  for (const service of input.services) {
    if (!service.resource) {
      continue
    }
    const result = await input.infra.exec(
      service.name,
      fillDevEnvValues(pick(service.resource), input.env),
      input.logPath
    )
    if (!result.ok) {
      return { ok: false, error: `Data for ${service.name} failed (exit ${String(result.code)})` }
    }
    created.push(service.name)
  }
  return { ok: true, created }
}

/** Creates this environment's resources (database, bucket, …) in the shared infra. */
export function provisionDevEnvData(
  input: DevEnvDataInput
): Promise<{ ok: true; created: string[] } | { ok: false; error: string }> {
  return runResourceCommands(input, (resource) => resource.create)
}

export function dropDevEnvData(
  input: DevEnvDataInput
): Promise<{ ok: true; created: string[] } | { ok: false; error: string }> {
  return runResourceCommands(input, (resource) => resource.drop)
}
