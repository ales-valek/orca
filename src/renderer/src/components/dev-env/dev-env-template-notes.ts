import type { DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'
import { t } from './dev-env-labels'

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
      t(
        'picker.slotMissing',
        'Slot {slot} has no repo in this mission, so {services} will not start.'
      )
        .replace('{slot}', slot.name)
        .replace('{services}', slot.services.map((service) => service.name).join(', '))
    )
}
