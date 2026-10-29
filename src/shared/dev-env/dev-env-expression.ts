import type { DevEnvContext, DevEnvValueSource } from './dev-env-context'
import type { DevEnv, DevEnvServiceDef } from './dev-env-types'

const EXPRESSION = /\$\{([A-Za-z0-9_.*-]+)\}/g

export type DevEnvInterpolation =
  | { value: string; sources: DevEnvValueSource[]; secret: boolean }
  | { error: string }

export function interpolateDevEnvValue(
  template: string,
  context: DevEnvContext
): DevEnvInterpolation {
  const sources: DevEnvValueSource[] = []
  let secret = false
  let missing: string | null = null
  const value = template.replace(EXPRESSION, (match, key: string) => {
    const entry = context.get(key)
    if (!entry) {
      missing ??= match
      return match
    }
    if (!sources.includes(entry.source)) {
      sources.push(entry.source)
    }
    secret ||= entry.secret
    return entry.value
  })
  if (missing !== null) {
    return { error: `Unresolved ${String(missing)}` }
  }
  return { value, sources: sources.length > 0 ? sources : ['literal'], secret }
}

/**
 * Prod-build mode swaps in the service's prod variant; services without one keep their dev command.
 * Null on Windows for a variant with `build`: chaining depends on the user's terminal shell there.
 */
export function getDevEnvServiceCommand(
  service: Pick<DevEnvServiceDef, 'command' | 'prod'>,
  mode: DevEnv['mode'],
  platform: NodeJS.Platform
): string | null {
  if (mode !== 'prod' || !service.prod) {
    return service.command
  }
  if (!service.prod.build) {
    return service.prod.start
  }
  return platform === 'win32' ? null : `${service.prod.build} && ${service.prod.start}`
}

/** Commands are typed into a visible terminal, so secrets stay in env files instead. */
export function renderDevEnvServiceCommand(
  command: string,
  context: DevEnvContext
): { command: string } | { error: string } {
  const result = interpolateDevEnvValue(command, context)
  if ('error' in result) {
    return result
  }
  return result.secret
    ? { error: 'Service commands cannot use secrets; put them in an env file' }
    : { command: result.value }
}
