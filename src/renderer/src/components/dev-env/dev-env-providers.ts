import type { DevEnvSummary, DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'

/** Local environments that run `service` in a bound slot, so a dependency can pair with them. */
export function getDevEnvProviders(
  envs: readonly DevEnvSummary[],
  templates: readonly DevEnvTemplate[],
  service: string,
  excludeId?: string
): DevEnvSummary[] {
  return envs.filter((env) => {
    if (env.id === excludeId || env.detached) {
      return false
    }
    const template = templates.find((entry) => entry.id === env.templateId)
    return Boolean(
      template?.slots.some(
        (slot) =>
          env.slotWorktrees[slot.name] && slot.services.some((entry) => entry.name === service)
      )
    )
  })
}

/** Select values for remote tiers; local providers are env ids, which never carry this prefix. */
export const DEV_ENV_REMOTE_PREFIX = 'remote:'

/** Local providers go to create; remote tiers are bound afterwards over the desktop-only channel. */
export function splitDevEnvBindings(bindings: Record<string, string>): {
  local: Record<string, string>
  remote: { dependency: string; tierId: string }[]
} {
  const local: Record<string, string> = {}
  const remote: { dependency: string; tierId: string }[] = []
  for (const [dependency, value] of Object.entries(bindings)) {
    if (value.startsWith(DEV_ENV_REMOTE_PREFIX)) {
      remote.push({ dependency, tierId: value.slice(DEV_ENV_REMOTE_PREFIX.length) })
    } else {
      local[dependency] = value
    }
  }
  return { local, remote }
}
