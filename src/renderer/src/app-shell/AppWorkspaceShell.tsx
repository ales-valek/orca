import { memo, Suspense, useCallback, useRef } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { usePluginViewCaptureStore } from '@/store/plugins/capture/plugin-view-capture'
import { pendingCreationOpensNativeChat } from '@/lib/workspace/creation/pending-worktree-creation'
import Sidebar from '../components/Sidebar'
import RightSidebar from '../components/right-sidebar'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import { FloatingTerminalToggleButton } from '../components/floating-terminal/FloatingTerminalToggleButton'
import { TerminalWorkbenchContainer } from '../components/TerminalWorkbenchContainer'
import { DevToolsPageHost } from '../components/dev-tools/DevToolsPageHost'
import type { VirtualizedScrollAnchor } from '../hooks/useVirtualizedScrollAnchor'
import { TitlebarLeftControls, WorkspaceSidebarToggle } from './TitlebarLeftControls'
import { RightSidebarToggle, TitlebarMainStrip } from './TitlebarMainStrip'
import type { AppChromeLayout } from './use-app-chrome-layout'
import type { FloatingWorkspacePanelState } from './use-floating-workspace-panel'

// Skips the shell render each workspace switch causes; its props only change on toggle.
const MemoFloatingTerminalToggleButton = memo(FloatingTerminalToggleButton)

const Landing = lazy(() => import('../components/Landing'))
const WorktreeCreationPanel = lazy(
  () => import('../components/worktree-creation/WorktreeCreationPanel')
)
const PendingNativeChatCreation = lazy(
  () => import('../components/worktree-creation/PendingNativeChatCreation')
)
const TaskPage = lazy(() => import('../components/task-page/TaskPage'))
const AutomationsPage = lazy(() => import('../components/automations/AutomationsPage'))
const ActivityPrototypePage = lazy(() => import('../components/activity/ActivityPrototypePage'))
const Settings = lazy(() => import('../components/settings/Settings'))
const SkillsPage = lazy(() => import('../components/skills/SkillsPage'))
const ArtifactsPage = lazy(() => import('../components/artifacts/ArtifactsPage'))
const WorkspaceSpacePage = lazy(() => import('../components/workspace-space/WorkspaceSpacePage'))
const MobilePage = lazy(() => import('../components/mobile/MobilePage'))
const DevEnvPage = lazy(() => import('../components/dev-env/DevEnvPage'))
const DevToolsPage = lazy(() => import('../components/dev-tools/DevToolsPage'))
const Terminal = lazy(() => import('../components/Terminal'))

type WorktreeSidebarScrollRefs = {
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
}

function WorktreeSidebar({
  layout,
  scrollRefs
}: {
  layout: AppChromeLayout
  scrollRefs: WorktreeSidebarScrollRefs
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="sidebar.worktrees"
      surface="sidebar"
      resetKey={layout.activeView}
      title={t('auto.App.1468601e7b', 'The workspace list hit an error.')}
      description={
        layout.leftTitlebarChromeLayout.shouldMount
          ? t(
              'auto.App.bdc71dddc9',
              'The active workspace remains open. Retry the list or switch views.'
            )
          : t(
              'auto.App.cba0fafda5',
              'The active page remains open. Retry the list or switch views.'
            )
      }
    >
      <Sidebar
        worktreeScrollOffsetRef={scrollRefs.scrollOffsetRef}
        worktreeScrollAnchorRef={scrollRefs.scrollAnchorRef}
        edge={layout.workspaceSidebarOnLeft ? 'left' : 'right'}
      />
    </RecoverableRenderErrorBoundary>
  )
}

// A chat-bound creation shows the chat itself, usable before its worktree exists.
function PendingCreationSurface(props: {
  creationId: string
  reserveCollapsedSidebarHeaderSpace: boolean
}): React.JSX.Element {
  const opensChat = useAppStore((s) => {
    const entry = s.pendingWorktreeCreations[props.creationId]
    return entry ? pendingCreationOpensNativeChat(entry) : false
  })
  return opensChat ? <PendingNativeChatCreation {...props} /> : <WorktreeCreationPanel {...props} />
}

// Why: keep the shell mounted for layout stability (heavy panels disconnect while closed); unmount on the distraction-free tasks view.
function ActivitySidebar({ layout }: { layout: AppChromeLayout }): React.JSX.Element | null {
  const t = useTranslate()
  if (!layout.showRightSidebarControls) {
    return null
  }
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="right-sidebar"
      surface="right-sidebar"
      resetKey={
        layout.rightSidebarTab === 'explorer'
          ? `${layout.rightSidebarTab}:${layout.rightSidebarExplorerView}`
          : layout.rightSidebarTab
      }
      title={t('auto.App.ed6b168d00', 'The right sidebar hit an error.')}
      description={t(
        'auto.App.8d1e160ed1',
        'Retry the sidebar or switch tabs to reload this surface.'
      )}
    >
      <RightSidebar
        edge={layout.activitySidebarEdge}
        windowControlsEdge={layout.sidebarSlots.windowControlsEdge}
      />
    </RecoverableRenderErrorBoundary>
  )
}

// Why: mirrors the left slot's 36px header so a right-mounted workspace list keeps its toggle
// aligned with the activity sidebar's own header row.
function TrailingWorkspaceSidebarSlot({
  layout,
  scrollRefs
}: {
  layout: AppChromeLayout
  scrollRefs: WorktreeSidebarScrollRefs
}): React.JSX.Element {
  return (
    <div
      className={`flex min-h-0 flex-col shrink-0${
        layout.sidebarOpen ? '' : ' relative w-0 overflow-visible'
      }`}
    >
      <div
        // Why: when collapsed the slot is 0-wide, so float the header at the right edge
        // (mirror of the left header's top-left float) to keep the re-expand toggle reachable.
        className={`titlebar-left justify-end${
          layout.sidebarOpen
            ? ''
            : ' titlebar-left-floating absolute top-0 right-0 z-10 w-max border-l border-border'
        }`}
        style={{
          width: layout.sidebarOpen ? '100%' : undefined,
          // Why: on Windows/Linux the window-controls overlay owns this right corner; keep the toggle clear of it.
          paddingRight:
            layout.sidebarSlots.windowControlsEdge === 'right'
              ? 'var(--window-controls-width)'
              : undefined
        }}
      >
        <WorkspaceSidebarToggle edge="right" />
      </div>
      <div className="flex min-h-0 flex-1">
        <WorktreeSidebar layout={layout} scrollRefs={scrollRefs} />
      </div>
    </div>
  )
}

function ActivePage({ layout }: { layout: AppChromeLayout }): React.JSX.Element {
  const { activeView, hasActiveWorktree, activePendingCreationId, creationLayoutActive } = layout
  return (
    <>
      {activeView === 'settings' ? <Settings /> : null}
      {activeView === 'skills' ? <SkillsPage /> : null}
      {activeView === 'artifacts' ? <ArtifactsPage /> : null}
      {activeView === 'tasks' ? <TaskPage /> : null}
      {activeView === 'automations' ? <AutomationsPage /> : null}
      {activeView === 'activity' ? <ActivityPrototypePage /> : null}
      {activeView === 'space' ? <WorkspaceSpacePage /> : null}
      {activeView === 'mobile' ? <MobilePage /> : null}
      {activeView === 'dev-envs' ? <DevEnvPage /> : null}
      {activeView === 'terminal' && creationLayoutActive && activePendingCreationId ? (
        <PendingCreationSurface
          creationId={activePendingCreationId}
          reserveCollapsedSidebarHeaderSpace={layout.leftColumnHeaderFloating}
        />
      ) : null}
      {activeView === 'terminal' && !hasActiveWorktree && !creationLayoutActive ? (
        <Landing />
      ) : null}
    </>
  )
}

export function AppWorkspaceShell(props: {
  layout: AppChromeLayout
  floatingWorkspace: FloatingWorkspacePanelState
}): React.JSX.Element {
  const t = useTranslate()
  const { layout, floatingWorkspace } = props
  const titlebarLeftControls = <TitlebarLeftControls layout={layout} />
  const titlebarMainStrip = <TitlebarMainStrip layout={layout} />
  // Keep scroll memory above sidebar view remounts to preserve list position.
  const scrollOffsetRef = useRef(0)
  const scrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const sidebarScrollRefs = { scrollOffsetRef, scrollAnchorRef }
  const { setOpenWithFocus } = floatingWorkspace
  // `orca plugin shot` captures the right sidebar, which the parked launcher floats over.
  const capturingPluginShot = usePluginViewCaptureStore((s) => s.capturing)
  const toggleFloatingWorkspace = useCallback(
    () => setOpenWithFocus((open) => !open),
    [setOpenWithFocus]
  )

  return (
    // Avoid active-worktree reset keys that remount whole surfaces during wake.
    <RecoverableRenderErrorBoundary
      boundaryId="app.workspace-shell"
      surface="workspace-shell"
      resetKey={layout.activeView}
      title={t('auto.App.df1d56bf87', 'The workspace shell hit an error.')}
      description={t(
        'auto.App.8504ddf267',
        'The app is still running. Retry the shell or use the menu to report the crash details.'
      )}
    >
      <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
        {/* Keep the non-workspace titlebar from spanning the right sidebar. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Workspace tab groups reach the top; other pages retain the titlebar. */}
          {!layout.leftTitlebarChromeLayout.shouldMount ? (
            <div className="titlebar">
              <div className="flex items-center shrink-0 mr-2">{titlebarLeftControls}</div>
              {titlebarMainStrip}
            </div>
          ) : null}
          <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
            {layout.showSidebar ? (
              layout.leftTitlebarChromeLayout.shouldMount ? (
                /* Remove the collapsed header from flex layout so panes reclaim the left edge. */
                <div
                  className={`flex min-h-0 flex-col shrink-0${
                    layout.leftSlotOpen ? '' : ' relative w-0 overflow-visible'
                  }`}
                >
                  <div
                    // The floating header covers the center border; restore the seam and size to its own controls.
                    className={`titlebar-left${
                      layout.leftColumnHeaderFloating
                        ? ' titlebar-left-floating absolute top-0 left-0 z-10 w-max border-r border-border'
                        : ''
                    }`}
                    style={{
                      // Why: custom sidebar appearances are scoped to the sidebar root; mirror those vars onto the header in the same left-column panel.
                      ...(layout.workspaceSidebarOnLeft && layout.sidebarOpen
                        ? layout.leftSidebarStyle
                        : undefined),
                      // Why: size from the wrapper's live width so the header tracks in-flight drag resizes (persisted to Zustand only on mouseup).
                      width: layout.leftSlotOpen ? '100%' : undefined
                    }}
                  >
                    {titlebarLeftControls}
                  </div>
                  {/* Keep a shrinkable flex viewport below the fixed header so the sidebar can scroll. */}
                  <div className="flex min-h-0 flex-1">
                    {layout.workspaceSidebarOnLeft ? (
                      <WorktreeSidebar layout={layout} scrollRefs={sidebarScrollRefs} />
                    ) : (
                      <ActivitySidebar layout={layout} />
                    )}
                  </div>
                </div>
              ) : layout.workspaceSidebarOnLeft ? (
                <WorktreeSidebar layout={layout} scrollRefs={sidebarScrollRefs} />
              ) : (
                <ActivitySidebar layout={layout} />
              )
            ) : null}
            <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
              {/* Automations/artifacts own their headers; another titlebar would leave an empty stripe. */}
              {layout.stackedSidebarOpen &&
              layout.activeView !== 'automations' &&
              layout.activeView !== 'artifacts' ? (
                <div className="titlebar">{titlebarMainStrip}</div>
              ) : null}
              <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
                {/* Match the open sidebar header’s alignment to prevent toggle jitter; a left-mounted activity sidebar keeps its toggle in TitlebarLeftControls. */}
                {layout.workspaceChromeActive &&
                  !layout.rightSidebarOpen &&
                  layout.activitySidebarEdge === 'right' && (
                    <div
                      className="absolute top-0 z-10 flex items-center h-[36px]"
                      style={
                        {
                          // Why: --window-controls-width keeps the toggle clear of the fixed window-controls overlay (138px on custom chrome, 0px otherwise); no internal spacer — one would cover the pane-actions Ellipsis button with an unclickable div.
                          right: 'var(--window-controls-width)',
                          WebkitAppRegion: 'no-drag'
                        } as React.CSSProperties
                      }
                    >
                      {layout.showRightSidebarControls ? <RightSidebarToggle edge="right" /> : null}
                    </div>
                  )}
                <div className="flex flex-1 min-w-0 min-h-0 flex-col">
                  {layout.shouldMountTerminalWorkbench ? (
                    <TerminalWorkbenchContainer isVisible={layout.terminalWorkbenchVisible}>
                      <Suspense fallback={null}>
                        <RecoverableRenderErrorBoundary
                          boundaryId="terminal.workbench"
                          surface="terminal-workbench"
                          resetKey="terminal"
                          title={t('auto.App.5a9519aef0', 'The workspace workbench hit an error.')}
                          description={t(
                            'auto.App.98d4ea2823',
                            'Terminal, browser, or editor rendering failed in this workspace. Retry to remount it.'
                          )}
                        >
                          <Terminal />
                        </RecoverableRenderErrorBoundary>
                      </Suspense>
                    </TerminalWorkbenchContainer>
                  ) : null}
                  <DevToolsPageHost isActive={layout.activeView === 'dev-tools'}>
                    <Suspense fallback={null}>
                      {/* Why: a fixed reset key; resetting on view changes would remount and reload tool tabs. */}
                      <RecoverableRenderErrorBoundary
                        boundaryId="dev-tools.page"
                        surface="page"
                        resetKey="dev-tools"
                        title={translate('devTools.error.title', 'The Tools page hit an error.')}
                        description={translate(
                          'devTools.error.description',
                          'Retry the page or navigate to another Orca surface.'
                        )}
                      >
                        <DevToolsPage />
                      </RecoverableRenderErrorBoundary>
                    </Suspense>
                  </DevToolsPageHost>
                  <Suspense fallback={null}>
                    <RecoverableRenderErrorBoundary
                      boundaryId={`page.${layout.activeView}`}
                      surface="page"
                      resetKey={layout.activeView}
                      title={t('auto.App.b7a714db1e', 'This page hit an error.')}
                      description={t(
                        'auto.App.03a14f6b5b',
                        'Retry the page or navigate to another Orca surface.'
                      )}
                    >
                      <ActivePage layout={layout} />
                    </RecoverableRenderErrorBoundary>
                  </Suspense>
                </div>
                {floatingWorkspace.showToggleButton && !capturingPluginShot ? (
                  <MemoFloatingTerminalToggleButton
                    open={floatingWorkspace.open}
                    onToggle={toggleFloatingWorkspace}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {layout.workspaceSidebarOnLeft ? (
          <ActivitySidebar layout={layout} />
        ) : layout.showSidebar ? (
          <TrailingWorkspaceSidebarSlot layout={layout} scrollRefs={sidebarScrollRefs} />
        ) : null}
      </div>
    </RecoverableRenderErrorBoundary>
  )
}
