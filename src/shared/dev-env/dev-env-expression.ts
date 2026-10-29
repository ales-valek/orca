import type { DevEnvContext, DevEnvValueSource } from './dev-env-context'

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
