import { describe, expect, it } from 'vitest'
import { findDevToolTab } from './dev-tools-tabs'

const ADMINER = 'http://127.0.0.1:19180/?pgsql=postgres&username=postgres'

describe('findDevToolTab', () => {
  it('finds the open tab of a tool by origin, wherever the tool navigated', () => {
    const tabs = [
      { id: 'redis', url: 'http://127.0.0.1:19181/' },
      {
        id: 'db',
        url: 'http://127.0.0.1:19180/?pgsql=postgres&username=postgres&db=kiosek&select=api_partner_definition'
      }
    ]
    expect(findDevToolTab(tabs, ADMINER)).toBe('db')
  })

  it('does not match another port or an empty tab list', () => {
    expect(findDevToolTab([{ id: 'redis', url: 'http://127.0.0.1:19181/' }], ADMINER)).toBeNull()
    expect(findDevToolTab([], ADMINER)).toBeNull()
  })
})
