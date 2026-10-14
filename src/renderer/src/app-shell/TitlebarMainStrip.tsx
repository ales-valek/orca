import { Minimize2, PanelLeft, PanelRight } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import { ActivityTitlebarControls } from '../components/activity/ActivityTitlebarControls'
import { useShortcutLabel } from '../hooks/useShortcutLabel'
import { useAppStore } from '../store'
import { selectActiveTerminalChromeState } from './active-terminal-chrome-selector'
import { hasCustomTitleBar } from './app-window-chrome'
import type { AppChromeLayout } from './use-app-chrome-layout'

// Why: the toggle follows the activity sidebar to whichever edge it occupies, so its icon and label
// must name that edge — mirrors the RightSidebar header's own close button.
export function RightSidebarToggle({
  edge = 'right'
}: {
  edge?: 'left' | 'right'
}): React.JSX.Element {
  const t = useTranslate()
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)
  const rightSidebarShortcutLabel = useShortcutLabel('sidebar.right.toggle')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="sidebar-toggle mr-2"
          onClick={toggleRightSidebar}
          aria-label={
            edge === 'left'
              ? t('menu.toggleLeftSidebar', 'Toggle Left Sidebar')
              : t('auto.App.9e0b441a91', 'Toggle right sidebar')
          }
        >
          {edge === 'left' ? <PanelLeft size={16} /> : <PanelRight size={16} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {edge === 'left'
          ? t('menu.toggleLeftSidebar', 'Toggle Left Sidebar')
          : t('auto.App.c184e056de', 'Toggle right sidebar ({{value0}})', {
              value0: rightSidebarShortcutLabel
            })}
      </TooltipContent>
    </Tooltip>
  )
}

export function TitlebarMainStrip({ layout }: { layout: AppChromeLayout }): React.JSX.Element {
  const t = useTranslate()
  const handleToggleExpand = (): void => {
    const { effectiveActiveTabId } = selectActiveTerminalChromeState(useAppStore.getState())
    if (!effectiveActiveTabId) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, {
        detail: { tabId: effectiveActiveTabId }
      })
    )
  }

  return (
    <>
      {layout.activeView === 'activity' ? (
        <ActivityTitlebarControls />
      ) : layout.creationLayoutActive ? null : (
        <div
          id="titlebar-tabs"
          className={`flex flex-1 min-w-0 self-stretch${!layout.workspaceChromeActive ? ' invisible pointer-events-none' : ''}`}
        />
      )}
      {layout.showTitlebarExpandButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="titlebar-icon-button"
              onClick={handleToggleExpand}
              aria-label={t('auto.App.c1cf0b0e4a', 'Collapse pane')}
              disabled={!layout.activeTabCanExpand}
            >
              <Minimize2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {t('auto.App.c1cf0b0e4a', 'Collapse pane')}
          </TooltipContent>
        </Tooltip>
      )}
      {/* The open sidebar already renders its close button; a left-mounted one keeps its toggle in TitlebarLeftControls. */}
      {layout.showRightSidebarControls &&
      !layout.rightSidebarOpen &&
      layout.activitySidebarEdge === 'right' ? (
        <RightSidebarToggle edge="right" />
      ) : null}
      {/* Reserve the custom window-controls overlay’s width. */}
      {hasCustomTitleBar && <div className="window-controls-titlebar-spacer" />}
    </>
  )
}
