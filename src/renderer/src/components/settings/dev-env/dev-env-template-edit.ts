import { translate } from '@/i18n/i18n'
import type {
  DevEnvEnvLine,
  DevEnvServiceDef,
  DevEnvTemplate,
  DevEnvTemplateSlot
} from '../../../../../shared/dev-env/dev-env-types'

const ENV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s?(.*)$/

export function createDevEnvTemplate(id: string, name: string): DevEnvTemplate {
  return { id, name, slots: [], dependencies: [], credentials: [] }
}

function updateSlot(
  template: DevEnvTemplate,
  slotName: string,
  update: (slot: DevEnvTemplateSlot) => DevEnvTemplateSlot
): DevEnvTemplate {
  return {
    ...template,
    slots: template.slots.map((slot) => (slot.name === slotName ? update(slot) : slot))
  }
}

export function addDevEnvSlot(template: DevEnvTemplate, name: string): DevEnvTemplate {
  const taken = new Set(template.slots.map((slot) => slot.name))
  let unique = name
  for (let index = 2; taken.has(unique); index++) {
    unique = `${name}-${index}`
  }
  return {
    ...template,
    slots: [
      ...template.slots,
      { name: unique, repoId: null, install: [], envFiles: [], services: [] }
    ]
  }
}

export function removeDevEnvSlot(template: DevEnvTemplate, slotName: string): DevEnvTemplate {
  return { ...template, slots: template.slots.filter((slot) => slot.name !== slotName) }
}

export function updateDevEnvSlot(
  template: DevEnvTemplate,
  slotName: string,
  changes: Partial<DevEnvTemplateSlot>
): DevEnvTemplate {
  return updateSlot(template, slotName, (slot) => ({ ...slot, ...changes }))
}

/** `previousName` null appends a new service. */
export function upsertDevEnvService(
  template: DevEnvTemplate,
  slotName: string,
  previousName: string | null,
  service: DevEnvServiceDef
): DevEnvTemplate {
  return updateSlot(template, slotName, (slot) => ({
    ...slot,
    services:
      previousName === null
        ? [...slot.services, service]
        : slot.services.map((entry) => (entry.name === previousName ? service : entry))
  }))
}

export function removeDevEnvService(
  template: DevEnvTemplate,
  slotName: string,
  name: string
): DevEnvTemplate {
  return updateSlot(template, slotName, (slot) => ({
    ...slot,
    services: slot.services.filter((entry) => entry.name !== name)
  }))
}

/** `KEY = value` per line; blank lines and `#` comments are skipped. */
export function parseDevEnvEnvLines(text: string): { lines: DevEnvEnvLine[] } | { error: string } {
  const lines: DevEnvEnvLine[] = []
  const rows = text.split('\n')
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index].trim()
    if (row === '' || row.startsWith('#')) {
      continue
    }
    const match = ENV_LINE.exec(row)
    if (!match) {
      return {
        error: translate('devEnv.settings.lineError', 'Line {{line}}: expected KEY = value', {
          line: index + 1
        })
      }
    }
    lines.push({ key: match[1], value: match[2].trim() })
  }
  return { lines }
}

export function formatDevEnvEnvLines(lines: readonly DevEnvEnvLine[]): string {
  return lines.map((line) => `${line.key} = ${line.value}`).join('\n')
}

export function parseDevEnvList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}
