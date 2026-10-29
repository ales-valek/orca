import { translate } from '@/i18n/i18n'
import type { DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'

/** One note per slot whose repo the new mission leaves out; its services cannot run there. */
export function getDevEnvTemplateNotes(
  template: DevEnvTemplate,
  repoIds: readonly string[]
): string[] {
  return template.slots
    .filter(
      (slot) => slot.repoId !== null && !repoIds.includes(slot.repoId) && slot.services.length > 0
    )
    .map((slot) =>
      translate(
        'devEnv.picker.slotMissing',
        'Slot {slot} has no repo in this mission, so {services} will not start.'
      )
        .replace('{slot}', slot.name)
        .replace('{services}', slot.services.map((service) => service.name).join(', '))
    )
}
