import { ArrowLeft, ArrowRight, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react'
import logo from '../../../../resources/logo.svg'
import { translate } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { shouldShowWorktreeHistoryControls } from '../lib/titlebar-worktree-history-controls'
import {
  canGoBackWorktreeHistory,
  canGoForwardWorktreeHistory
} from '@/store/slices/ui/workspace-navigation-history'
import { useShortcutLabel } from '../hooks/useShortcutLabel'
import { useAppStore } from '../store'
import { hasCustomTitleBar, hasMacTrafficLights } from './app-window-chrome'
import { RightSidebarToggle } from './TitlebarMainStrip'
import type { AppChromeLayout } from './use-app-chrome-layout'

export function WorkspaceSidebarToggle({ edge }: { edge: 'left' | 'right' }): React.JSX.Element {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const leftSidebarShortcutLabel = useShortcutLabel('sidebar.left.toggle')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={
            edge === 'right'
              ? translate('auto.App.9e0b441a91', 'Toggle right sidebar')
              : translate('auto.App.e4b9e7dff7', 'Toggle sidebar')
          }
        >
          {edge === 'left' ? <PanelLeft size={16} /> : <PanelRight size={16} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {edge === 'right'
          ? translate('auto.App.c184e056de', 'Toggle right sidebar ({{value0}})', {
              value0: leftSidebarShortcutLabel
            })
          : translate('auto.App.ce37cf5279', 'Toggle sidebar ({{value0}})', {
              value0: leftSidebarShortcutLabel
            })}
      </TooltipContent>
    </Tooltip>
  )
}

/** Reuse left chrome across full-width and sidebar-width headers so controls/popovers stay consistent. */
export function TitlebarLeftControls({ layout }: { layout: AppChromeLayout }): React.JSX.Element {
  const t = useTranslate()
  const updateSettings = useAppStore((s) => s.updateSettings)
  const canGoBackWorktree = useAppStore(canGoBackWorktreeHistory)
  const canGoForwardWorktree = useAppStore(canGoForwardWorktreeHistory)
  const historyBackShortcutLabel = useShortcutLabel('worktree.history.back')
  const historyForwardShortcutLabel = useShortcutLabel('worktree.history.forward')

  return (
    // Measure the whole row for tab-strip spacing. w-max prevents the collapsed w-0 wrapper shrinking Windows text to one glyph.
    <div
      ref={layout.titlebarLeftControlsRef}
      className={`flex h-full shrink-0 items-center${
        layout.leftColumnHeaderFloating ? ' w-max' : ' w-full'
      }`}
    >
      <div className="flex h-full items-center">
        {hasMacTrafficLights && !layout.isFullScreen ? (
          <div className="titlebar-traffic-light-pad" />
        ) : hasCustomTitleBar ? (
          /* Replace native Windows/Linux chrome with logo and application-menu access. */
          <>
            <img src={logo} alt="" aria-hidden className="titlebar-logo" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="titlebar-icon-button"
                  aria-label={t('auto.App.8b0b8eb54f', 'Application menu')}
                  onClick={() => window.api.ui.popupMenu()}
                >
                  <MoreHorizontal size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t('auto.App.8b0b8eb54f', 'Application menu')}
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <div className="pl-2" />
        )}
        {layout.showSidebar && !hasCustomTitleBar && layout.showTitlebarAppName && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="titlebar-app-name" aria-label={t('auto.App.5096cbbc86', 'Orca')}>
                <span className="titlebar-app-name-main">{t('auto.App.5096cbbc86', 'Orca')}</span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  void updateSettings({ showTitlebarAppName: false })
                }}
              >
                {t('auto.App.e81217c1b7', 'Hide App Name')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        {layout.showSidebar && layout.workspaceSidebarOnLeft ? (
          <WorkspaceSidebarToggle edge="left" />
        ) : null}
        {/* Why: a left-mounted activity sidebar collapses its body to zero width, but this header persists —
            so its re-expand toggle belongs here, clear of the tab strip, rather than floating over the tabs. */}
        {layout.showRightSidebarControls &&
        layout.activitySidebarEdge === 'left' &&
        !layout.rightSidebarOpen ? (
          <RightSidebarToggle edge="left" />
        ) : null}
      </div>
      {/* Show shared workspace/page history wherever its shortcut is available. */}
      {shouldShowWorktreeHistoryControls(layout.activeView) && (
        // Collapsed headers shrink-wrap, so ml-auto alone cannot leave a history-button gutter.
        <div className="ml-auto mr-3 flex items-center pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goBackWorktree()}
                disabled={!canGoBackWorktree}
                aria-label={t('auto.App.064bd07810', 'Go back')}
              >
                <ArrowLeft size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.fe21e8f6f5', 'Go back ({{value0}})', {
                value0: historyBackShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goForwardWorktree()}
                disabled={!canGoForwardWorktree}
                aria-label={t('auto.App.cf9099fe98', 'Go forward')}
              >
                <ArrowRight size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.f7aa73e785', 'Go forward ({{value0}})', {
                value0: historyForwardShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
