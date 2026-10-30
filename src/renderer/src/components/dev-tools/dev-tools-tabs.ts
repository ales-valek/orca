import { useAppStore } from '@/store'
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

/** Activates the tool's tab, or opens one in the Tools page workspace. */
export function openDevToolTab(view: DevToolView, url: string): void {
  const state = useAppStore.getState()
  const existing = findDevToolTab(state.browserTabsByWorktree[DEV_TOOLS_WORKTREE_ID] ?? [], url)
  if (existing) {
    state.setActiveBrowserTab(existing, DEV_TOOLS_WORKTREE_ID)
    return
  }
  // Why: tools are local web UIs; a remote runtime must not own or route them.
  state.createBrowserTab(DEV_TOOLS_WORKTREE_ID, url, {
    browserRuntimeEnvironmentId: null,
    title: view.label
  })
}
