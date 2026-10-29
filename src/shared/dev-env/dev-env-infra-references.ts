import type { DevEnvInfraService, DevEnvTemplate } from './dev-env-types'

/** Infra the template uses through `dependsOn` or `${infra.<name>…}`, in settings order. */
export function getReferencedDevEnvInfra(
  template: DevEnvTemplate,
  infra: DevEnvInfraService[]
): DevEnvInfraService[] {
  const text = JSON.stringify(template)
  const dependsOn = new Set(
    template.slots.flatMap((slot) => slot.services.flatMap((s) => s.dependsOn))
  )
  return infra.filter(
    (service) => dependsOn.has(service.name) || text.includes(`\${infra.${service.name}.`)
  )
}
