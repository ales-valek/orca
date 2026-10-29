import { getDevEnvPort } from './dev-env-ports'
import type { DevEnv, DevEnvInfraService, DevEnvServiceDef, DevEnvTemplate } from './dev-env-types'

export type DevEnvValueSource =
  | 'port'
  | 'infra'
  | 'data'
  | 'service'
  | 'hostname'
  | 'dependency'
  | 'secret'
  | 'literal'

export type DevEnvContextValue = { value: string; source: DevEnvValueSource; secret: boolean }

export type DevEnvContext = ReadonlyMap<string, DevEnvContextValue>

export type DevEnvExportValue = { value: string; secret: boolean }

export type DevEnvDependencyValues = {
  url: string
  /** A remote tier url may embed `${secret.x}`. */
  urlSecret?: boolean
  exports: Record<string, DevEnvExportValue>
}

const ORCA_LOCALHOST_SUFFIX = '.orca.localhost'
const LOOPBACK = '127.0.0.1'

/** The service's host pattern with the env key filled in, e.g. "*.eshop.kiosek". */
export function getDevEnvServiceHost(service: DevEnvServiceDef, envKey: string): string | null {
  return service.host ? service.host.split('${devEnv.key}').join(envKey) : null
}

export function getDevEnvServiceUrl(
  service: DevEnvServiceDef,
  envKey: string,
  port: number,
  proxyPort: number
): string {
  const host = getDevEnvServiceHost(service, envKey)
  if (!host) {
    return `http://${LOOPBACK}:${port}`
  }
  const portSuffix = proxyPort === 80 ? '' : `:${proxyPort}`
  return `http://${host.replace(/^\*\./, '')}${ORCA_LOCALHOST_SUFFIX}${portSuffix}`
}

export function buildDevEnvContext(input: {
  env: Pick<DevEnv, 'key' | 'portSlot'>
  template: DevEnvTemplate
  infra: DevEnvInfraService[]
  proxyPort: number
  secrets: ReadonlyMap<string, string>
  dependencies: ReadonlyMap<string, DevEnvDependencyValues>
}): DevEnvContext {
  const context = new Map<string, DevEnvContextValue>()
  const add = (key: string, value: string, source: DevEnvValueSource, secret = false): void => {
    context.set(key, { value, source, secret })
  }
  add('devEnv.key', input.env.key, 'data')
  add('devEnv.slot', String(input.env.portSlot), 'port')
  for (const slot of input.template.slots) {
    for (const service of slot.services) {
      const port = getDevEnvPort(input.env.portSlot, service.portOffset)
      add(`self.${service.name}.port`, String(port), 'port')
      add(
        `self.${service.name}.url`,
        getDevEnvServiceUrl(service, input.env.key, port, input.proxyPort),
        'service'
      )
      const host = getDevEnvServiceHost(service, input.env.key)
      add(
        `self.${service.name}.host`,
        host ? `${host.replace(/^\*\./, '')}${ORCA_LOCALHOST_SUFFIX}` : LOOPBACK,
        'hostname'
      )
    }
  }
  for (const service of input.infra) {
    add(`infra.${service.name}.host`, LOOPBACK, 'infra')
    if (service.ports[0]) {
      add(`infra.${service.name}.port`, String(service.ports[0].host), 'infra')
    }
    for (const port of service.ports) {
      add(`infra.${service.name}.port.${port.name}`, String(port.host), 'infra')
    }
  }
  for (const [name, value] of input.secrets) {
    add(`secret.${name}`, value, 'secret', true)
  }
  for (const [name, dependency] of input.dependencies) {
    add(`dep.${name}.url`, dependency.url, 'dependency', dependency.urlSecret === true)
    for (const [key, exported] of Object.entries(dependency.exports)) {
      add(`dep.${name}.${key}`, exported.value, 'dependency', exported.secret)
    }
  }
  return context
}
