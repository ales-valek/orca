import { describe, expect, it } from 'vitest'
import { normalizeDevEnvSettings } from './dev-env-settings'
import { normalizeDevTool, normalizeDevTools } from './dev-tools-settings'

const ADMINER = {
  kind: 'adminer',
  name: 'db',
  label: 'Databáze',
  port: 19180,
  infraService: 'postgres'
}
const MAIL = {
  kind: 'link',
  name: 'mail',
  label: 'Pošta',
  infraService: 'inbucket',
  portName: 'ui'
}

describe('normalizeDevTool', () => {
  it('keeps a container tool and a link tool', () => {
    expect(normalizeDevTool(ADMINER)).toEqual(ADMINER)
    const mail = normalizeDevTool(MAIL)
    expect(mail).toEqual(MAIL)
    expect(mail && 'path' in mail ? mail.path : undefined).toBeUndefined()
  })

  it('drops unknown kinds, privileged or invalid ports, bad names and bad links', () => {
    expect(normalizeDevTool({ ...ADMINER, kind: 'pgadmin' })).toBeNull()
    expect(normalizeDevTool({ ...ADMINER, port: 80 })).toBeNull()
    expect(normalizeDevTool({ ...ADMINER, port: 70000 })).toBeNull()
    expect(normalizeDevTool({ ...ADMINER, name: '../x' })).toBeNull()
    expect(normalizeDevTool({ ...MAIL, portName: undefined })).toBeNull()
    expect(normalizeDevTool({ ...MAIL, path: 'play' })).toBeNull()
    expect(normalizeDevTool({ ...MAIL, path: '/play' })).toEqual({ ...MAIL, path: '/play' })
  })

  it('keeps the first tool of a duplicated name', () => {
    expect(normalizeDevTools([ADMINER, { ...ADMINER, label: 'Again' }])).toEqual([ADMINER])
  })
})

describe('devEnvTools in settings', () => {
  it('defaults to an empty list for old settings', () => {
    expect(normalizeDevEnvSettings({}, 'darwin').devEnvTools).toEqual([])
  })
})
