import { describe, expect, it } from 'vitest'
import { findDevToolTab, openDevToolTab } from './dev-tools-tabs'

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

describe('openDevToolTab', () => {
  function setup(tabs: { id: string; url: string; activePageId: string }[]) {
    const activated: string[] = []
    const created: string[] = []
    const reloaded: string[] = []
    const deps = {
      getState: () => ({
        browserTabsByWorktree: { 'global-dev-tools': tabs },
        setActiveBrowserTab: (id: string) => activated.push(id),
        createBrowserTab: (_worktreeId: string, url: string) => {
          created.push(url)
          return { id: 'new' }
        }
      }),
      reloadPage: (pageId: string) => reloaded.push(pageId)
    }
    return { deps, activated, created, reloaded }
  }
  const VIEW = {
    name: 'db',
    label: 'Databáze',
    kind: 'adminer' as const,
    state: 'running' as const,
    url: ADMINER
  }

  it('reloads the open tab when the tool was just started, so it drops a stale error page', () => {
    const { deps, activated, reloaded } = setup([
      { id: 'db', url: ADMINER, activePageId: 'page-db' }
    ])
    openDevToolTab(VIEW, ADMINER, { reload: true }, deps)
    expect(activated).toEqual(['db'])
    expect(reloaded).toEqual(['page-db'])
  })

  it('only activates the open tab of a tool that was already running', () => {
    const { deps, reloaded } = setup([{ id: 'db', url: ADMINER, activePageId: 'page-db' }])
    openDevToolTab(VIEW, ADMINER, { reload: false }, deps)
    expect(reloaded).toEqual([])
  })

  it('opens a new tab when none is open', () => {
    const { deps, created } = setup([])
    openDevToolTab(VIEW, ADMINER, { reload: true }, deps)
    expect(created).toEqual([ADMINER])
  })
})
