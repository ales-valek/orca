import { describe, expect, it } from 'vitest'
import type { DevEnvTemplate } from '../../../../../shared/dev-env/dev-env-types'
import {
  addDevEnvSlot,
  createDevEnvTemplate,
  formatDevEnvEnvLines,
  parseDevEnvEnvLines,
  removeDevEnvService,
  removeDevEnvSlot,
  upsertDevEnvService
} from './dev-env-template-edit'

const BASE: DevEnvTemplate = createDevEnvTemplate('t1', 'OrderMage')

describe('dev env template edits', () => {
  it('adds a slot with a unique name and removes it', () => {
    const one = addDevEnvSlot(BASE, 'admin')
    const two = addDevEnvSlot(one, 'admin')
    expect(two.slots.map((slot) => slot.name)).toEqual(['admin', 'admin-2'])
    expect(removeDevEnvSlot(two, 'admin').slots.map((slot) => slot.name)).toEqual(['admin-2'])
  })

  it('upserts a service by its previous name and removes it', () => {
    const withSlot = addDevEnvSlot(BASE, 'admin')
    const service = { name: 'api', command: 'nx serve backend', portOffset: 10, dependsOn: [] }
    const added = upsertDevEnvService(withSlot, 'admin', null, service)
    const renamed = upsertDevEnvService(added, 'admin', 'api', { ...service, name: 'admin-api' })
    expect(renamed.slots[0].services.map((entry) => entry.name)).toEqual(['admin-api'])
    expect(removeDevEnvService(renamed, 'admin', 'admin-api').slots[0].services).toEqual([])
  })

  it('parses KEY = value lines, keeping values with equals signs', () => {
    expect(parseDevEnvEnvLines('PORT = ${self.api.port}\n\n# note\nURL=http://x?a=b\n')).toEqual({
      lines: [
        { key: 'PORT', value: '${self.api.port}' },
        { key: 'URL', value: 'http://x?a=b' }
      ]
    })
  })

  it('reports the line number of a malformed line', () => {
    expect(parseDevEnvEnvLines('PORT = 1\nnot a line\n')).toEqual({
      error: 'Line 2: expected KEY = value'
    })
  })

  it('formats lines back', () => {
    expect(formatDevEnvEnvLines([{ key: 'A', value: '1' }])).toBe('A = 1')
  })
})
