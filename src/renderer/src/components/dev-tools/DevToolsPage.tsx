import { translate } from '@/i18n/i18n'
import React, { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import TabGroupSplitLayout from '@/components/tab-group/TabGroupSplitLayout'
import { WorkspacePaneOverlayLayers } from '@/components/WorkspacePaneOverlayLayers'
import { useAppStore } from '@/store'
import { DEV_TOOLS_WORKTREE_ID } from '../../../../shared/constants'
import type { DevToolView } from '../../../../shared/dev-env/dev-tools-types'
import { runDevEnvAction } from '../dev-env/dev-env-actions'
import { resolveFloatingWorkspaceSurfaceModel } from '../floating-terminal/floating-workspace-surface-model'
import { DevToolCard } from './DevToolCard'
import { openDevToolTab } from './dev-tools-tabs'

const POLL_MS = 3000
const NO_ACTIVITY_TERMINAL_PORTALS: [] = []
const NO_TOOLS: readonly DevToolView[] = []

function useDevToolViews(isActive: boolean): {
  views: readonly DevToolView[]
  refresh: () => Promise<void>
} {
  const [views, setViews] = useState<readonly DevToolView[]>(NO_TOOLS)
  const refresh = useCallback(async () => {
    setViews(await window.api.devTools.list())
  }, [])
  useEffect(() => {
    if (!isActive) {
      return
    }
    void refresh()
    // Why: tool and infra state come from docker, which pushes no change event.
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [isActive, refresh])
  return { views, refresh }
}

function DevToolLogDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('')
  useEffect(() => {
    void window.api.devTools.readLog().then(setText)
  }, [])
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{translate('devTools.logTitle', 'Tools log')}</DialogTitle>
        </DialogHeader>
        <pre className="scrollbar-sleek max-h-96 overflow-auto bg-muted/40 px-3 py-2 font-mono text-xs whitespace-pre-wrap">
          {text || translate('devTools.emptyLog', 'No output yet.')}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

/** Tools page: tool cards above, tool browser tabs below. Stays mounted so tabs keep their state. */
export default function DevToolsPage(): React.JSX.Element {
  const isActive = useAppStore((s) => s.activeView === 'dev-tools')
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const surface = useAppStore(
    useShallow((s) => resolveFloatingWorkspaceSurfaceModel(s, DEV_TOOLS_WORKTREE_ID))
  )
  const { views, refresh } = useDevToolViews(isActive)
  const [busy, setBusy] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  const act = (name: string, label: string, action: () => Promise<void>): void => {
    setBusy(name)
    void runDevEnvAction(label, action).finally(() => {
      setBusy(null)
      void refresh()
    })
  }
  const open = (view: DevToolView): void =>
    act(view.name, translate('devTools.openFailed', 'Could not open the tool'), async () => {
      const result = await window.api.devTools.open({ name: view.name })
      if ('error' in result) {
        throw new Error(result.error)
      }
      openDevToolTab(view, result.url)
    })
  const restart = (view: DevToolView): void =>
    act(view.name, translate('devTools.restartFailed', 'Could not restart the tool'), async () => {
      const result = await window.api.devTools.restart({ name: view.name })
      if ('error' in result) {
        throw new Error(result.error)
      }
    })
  const stop = (view: DevToolView): void =>
    act(view.name, translate('devTools.stopFailed', 'Could not stop the tool'), () =>
      window.api.devTools.stop({ name: view.name })
    )
  const startInfra = (view: DevToolView): void =>
    act(view.name, translate('devTools.startInfraFailed', 'Could not start infra'), async () => {
      const result = await window.api.devEnv.infraUp({})
      if (!result.ok) {
        throw new Error(result.error ?? view.label)
      }
    })

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-[15px] font-semibold">{translate('devTools.title', 'Tools')}</h1>
        {views.length === 0 ? (
          <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
            <Wrench className="size-4" />
            <span className="flex-1">
              {translate(
                'devTools.empty',
                'No tools yet. Add them in Settings → Dev Environments → Tools.'
              )}
            </span>
            <Button variant="outline" size="sm" onClick={() => openSettingsPage()}>
              {translate('devTools.openSettings', 'Open settings')}
            </Button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {views.map((view) => (
              <DevToolCard
                key={view.name}
                view={view}
                busy={busy === view.name}
                onOpen={() => open(view)}
                onRestart={() => restart(view)}
                onStop={() => stop(view)}
                onStartInfra={() => startInfra(view)}
                onLog={() => setLogOpen(true)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {surface.kind === 'workspace' ? (
          <div className="absolute inset-0 flex">
            <TabGroupSplitLayout
              layout={surface.layout}
              worktreeId={DEV_TOOLS_WORKTREE_ID}
              focusedGroupId={surface.focusedGroupId}
              isWorktreeActive={isActive}
            />
            <WorkspacePaneOverlayLayers
              worktreeId={DEV_TOOLS_WORKTREE_ID}
              worktreePath=""
              isVisible={isActive}
              shouldMeasureHiddenWorktree={false}
              shouldColdParkTerminalPanes={false}
              isForceParked={false}
              activityTerminalPortals={NO_ACTIVITY_TERMINAL_PORTALS}
              backgroundMountTabIds={null}
              activationDeferredMountTabIds={null}
              mountRetainedBrowserOverlay={true}
              mountEmulatorOverlay={false}
              ownsNativeChatToggleShortcut={false}
            />
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {translate('devTools.noTabs', 'Open a tool from a card above.')}
          </p>
        )}
      </div>
      {logOpen ? <DevToolLogDialog onClose={() => setLogOpen(false)} /> : null}
    </div>
  )
}
