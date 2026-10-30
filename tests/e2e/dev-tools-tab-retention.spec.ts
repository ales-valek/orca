// The Tools page keeps its tool tabs alive: leaving the page or switching worktrees must not reload them.

import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { browserOverlay } from './helpers/browser-split-fixture'
import {
  guestLoadStarts,
  recordGuestLoadStarts,
  waitForGuestIdle,
  waitForGuestUrl
} from './helpers/browser-split-guest-probes'
import { startBrowserSplitPageServer } from './helpers/browser-split-page-server'
import {
  ensureTerminalVisible,
  switchToOtherWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'

// Why: mirrors DEV_TOOLS_WORKTREE_ID in src/shared/constants.ts.
const DEV_TOOLS_WORKTREE_ID = 'global-dev-tools'
const TOOLS_PAGE = '[data-dev-tools-page-host]'

async function openToolTab(page: Page, url: string): Promise<string> {
  const browserTabId = await page.evaluate(
    ({ worktreeId, toolUrl }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const state = store.getState()
      state.openDevToolsPage()
      const tab = state.createBrowserTab(worktreeId, toolUrl, {
        activate: true,
        focusAddressBar: false,
        title: 'Databáze',
        browserRuntimeEnvironmentId: null
      })
      return tab.id
    },
    { worktreeId: DEV_TOOLS_WORKTREE_ID, toolUrl: url }
  )
  await expect(page.locator(`${TOOLS_PAGE}[aria-hidden="false"]`)).toHaveCount(1)
  await expect(browserOverlay(page, browserTabId)).toBeVisible()
  return browserTabId
}

async function setView(page: Page, view: 'terminal' | 'dev-envs' | 'dev-tools'): Promise<void> {
  await page.evaluate((next) => window.__store?.getState().setActiveView(next), view)
}

test.describe('Tools page tab retention', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('a tool tab survives leaving the page and switching worktrees without reloading', async ({
    orcaPage
  }) => {
    const server = await startBrowserSplitPageServer()
    try {
      const toolUrl = server.pageUrl('tool', 1)
      const browserTabId = await openToolTab(orcaPage, toolUrl)
      await waitForGuestUrl(orcaPage, browserTabId, toolUrl)
      await waitForGuestIdle(orcaPage, browserTabId)
      await recordGuestLoadStarts(orcaPage, [browserTabId])

      await setView(orcaPage, 'terminal')
      await switchToOtherWorktree(orcaPage, await waitForActiveWorktree(orcaPage))
      await setView(orcaPage, 'dev-envs')
      await setView(orcaPage, 'dev-tools')

      await expect(browserOverlay(orcaPage, browserTabId)).toBeVisible()
      await waitForGuestIdle(orcaPage, browserTabId)
      expect(await guestLoadStarts(orcaPage, browserTabId)).toBe(0)
    } finally {
      await server.close()
    }
  })
})
