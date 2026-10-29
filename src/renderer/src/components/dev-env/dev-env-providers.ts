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
