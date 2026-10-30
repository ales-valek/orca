import { useAppStore } from '@/store'
import { reloadBrowserPageWebview } from '../browser-pane/navigate/browser-reload-action'
import { webviewRegistry } from '../browser-pane/host-guest/webview-registry'
import { DEV_TOOLS_WORKTREE_ID } from '../../../../shared/constants'
import type { DevToolView } from '../../../../shared/dev-env/dev-tools-types'

function getOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** The open tab of a tool, matched by origin so in-tool navigation still counts. */
export function findDevToolTab(
  tabs: readonly { id: string; url: string }[],
  toolUrl: string
): string | null {
  const origin = getOrigin(toolUrl)
  return tabs.find((tab) => origin !== null && getOrigin(tab.url) === origin)?.id ?? null
}

type DevToolTabStore = {
  browserTabsByWorktree: Record<
    string,
    readonly { id: string; url: string; activePageId?: string | null }[]
  >
  setActiveBrowserTab: (tabId: string, targetWorktreeId?: string) => void
  createBrowserTab: (
    worktreeId: string,
    url: string,
    options: { browserRuntimeEnvironmentId: null; title: string }
  ) => unknown
}

function reloadDevToolPage(pageId: string): void {
  const webview = webviewRegistry.get(pageId)
  if (webview) {
    reloadBrowserPageWebview(webview, { ignoreCache: false })
  }
}

/**
 * Activates the tool's tab, or opens one in the Tools page workspace.
 * `reload` refreshes an open tab after the tool (re)started, which may still show a connection error.
 */
export function openDevToolTab(
  view: DevToolView,
  url: string,
  options: { reload: boolean },
  deps: { getState: () => DevToolTabStore; reloadPage: (pageId: string) => void } = {
    getState: useAppStore.getState,
    reloadPage: reloadDevToolPage
  }
): void {
  const state = deps.getState()
  const tabs = state.browserTabsByWorktree[DEV_TOOLS_WORKTREE_ID] ?? []
  const existing = findDevToolTab(tabs, url)
  if (existing) {
    state.setActiveBrowserTab(existing, DEV_TOOLS_WORKTREE_ID)
    const pageId = tabs.find((tab) => tab.id === existing)?.activePageId
    if (options.reload && pageId) {
      deps.reloadPage(pageId)
    }
    return
  }
  // Why: tools are local web UIs; a remote runtime must not own or route them.
  state.createBrowserTab(DEV_TOOLS_WORKTREE_ID, url, {
    browserRuntimeEnvironmentId: null,
    title: view.label
  })
}
