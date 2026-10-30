import { translate } from '@/i18n/i18n'
import React from 'react'
import { Button } from '@/components/ui/button'
import type { DevToolState, DevToolView } from '../../../../shared/dev-env/dev-tools-types'
import type { DevEnvTone } from '../dev-env/dev-env-labels'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'

const STATE_TONE: Record<DevToolState, DevEnvTone> = {
  running: 'ok',
  starting: 'info',
  'not-started': 'muted',
  'infra-stopped': 'warn',
  unavailable: 'error'
}

function getStateLabel(state: DevToolState): string {
  switch (state) {
    case 'running':
      return translate('devTools.state.running', 'Running')
    case 'starting':
      return translate('devTools.state.starting', 'Starting…')
    case 'not-started':
      return translate('devTools.state.notStarted', 'Starts when opened')
    case 'infra-stopped':
      return translate('devTools.state.infraStopped', 'Infra stopped')
    case 'unavailable':
      return translate('devTools.state.unavailable', 'Unavailable')
  }
}

export function DevToolCard({
  view,
  busy,
  onOpen,
  onRestart,
  onStop,
  onStartInfra,
  onLog
}: {
  view: DevToolView
  busy: boolean
  onOpen: () => void
  onRestart: () => void
  onStop: () => void
  onStartInfra: () => void
  onLog: () => void
}): React.JSX.Element {
  const isContainer = view.kind !== 'link'
  const canOpen = view.state === 'running' || view.state === 'not-started'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-[13px]">
      <div className="flex items-center gap-2">
        <DevEnvStatusDot tone={STATE_TONE[view.state]} />
        <span className="flex-1 truncate font-medium">{view.label}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground" title={view.detail}>
        {view.detail ?? getStateLabel(view.state)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {view.state === 'infra-stopped' ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={onStartInfra}>
            {translate('devTools.startInfra', 'Start infra')}
          </Button>
        ) : (
          <Button size="xs" disabled={busy || !canOpen} onClick={onOpen}>
            {translate('devTools.open', 'Open')}
          </Button>
        )}
        {isContainer && view.state === 'running' ? (
          <>
            <Button size="xs" variant="ghost" disabled={busy} onClick={onRestart}>
              {translate('devTools.restart', 'Restart')}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={onStop}>
              {translate('devTools.stop', 'Stop')}
            </Button>
          </>
        ) : null}
        {isContainer ? (
          <Button size="xs" variant="ghost" onClick={onLog}>
            {translate('devTools.log', 'Log')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
