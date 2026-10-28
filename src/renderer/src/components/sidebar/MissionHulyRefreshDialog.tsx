import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatHulyError, isHulyAuthRequiredError } from '@/components/huly-error-copy'
import { HulyReconnectNotice } from '@/components/huly-reconnect-notice'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { HulyMissionRefreshDiff } from '../../../../shared/huly/huly-mission-refresh'
import type { Mission, RuntimeMissionHulyRefreshResult } from '../../../../shared/mission-types'
import { getAppendableCount, MissionHulyRefreshDiffView } from './MissionHulyRefreshDiffView'

type DiffState =
  | { state: 'loading' }
  | { state: 'ready'; diff: HulyMissionRefreshDiff }
  | { state: 'error'; message: string }

/** What the last read or apply produced, for the Mission it was made for. */
type Outcome = {
  missionId: string
  diff: DiffState
  applyError: string | null
  authRequired: boolean
}

function showAppendResult(result: RuntimeMissionHulyRefreshResult): void {
  const count = result.applied.length
  const description = result.warnings.length > 0 ? result.warnings.join('\n') : undefined
  if (count === 0) {
    toast.warning(
      translate(
        'auto.components.sidebar.MissionHulyRefreshDialog.appendedNone',
        'No new tasks were appended.'
      ),
      description ? { description } : undefined
    )
    return
  }
  const message =
    count === 1
      ? translate(
          'auto.components.sidebar.MissionHulyRefreshDialog.appendedOne',
          'Appended 1 new task'
        )
      : translate(
          'auto.components.sidebar.MissionHulyRefreshDialog.appendedMany',
          'Appended {{count}} new tasks',
          { count }
        )
  if (description) {
    toast.warning(message, { description })
  } else {
    toast.success(message)
  }
}

/** "Refresh from Huly": shows what changed in the milestone; only appending new tasks is applied. */
export function MissionHulyRefreshDialog({
  mission,
  onOpenChange
}: {
  mission: Mission | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const refreshMissionFromHuly = useAppStore((s) => s.refreshMissionFromHuly)
  const repos = useAppStore((s) => s.repos)
  const repoNameById = new Map(repos.map((repo) => [repo.id, repo.displayName]))
  const missionId = mission?.id ?? null
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [applying, setApplying] = useState(false)
  // A closed dialog or another Mission never shows the previous diff, not even for one render.
  if (outcome !== null && outcome.missionId !== missionId) {
    setOutcome(null)
  }
  const current = outcome?.missionId === missionId ? outcome : null
  const diffState: DiffState = current?.diff ?? { state: 'loading' }

  useEffect(() => {
    if (!missionId) {
      return
    }
    let cancelled = false
    refreshMissionFromHuly(missionId, false).then(
      (result) => {
        if (!cancelled) {
          const diff = { state: 'ready' as const, diff: result.diff }
          setOutcome({ missionId, diff, applyError: null, authRequired: false })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          const diff = { state: 'error' as const, message: formatHulyError(error) }
          const authRequired = isHulyAuthRequiredError(error)
          setOutcome({ missionId, diff, applyError: null, authRequired })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [missionId, attempt, refreshMissionFromHuly])

  const appendableCount = diffState.state === 'ready' ? getAppendableCount(diffState.diff) : 0
  const authRequired = current?.authRequired ?? false

  function reloadAfterReconnect(): void {
    setOutcome(null)
    setAttempt((value) => value + 1)
  }

  async function handleAppend(): Promise<void> {
    if (!missionId || !current) {
      return
    }
    setApplying(true)
    setOutcome({ ...current, applyError: null })
    try {
      showAppendResult(await refreshMissionFromHuly(missionId, true))
      onOpenChange(false)
    } catch (error) {
      setOutcome({
        ...current,
        applyError: formatHulyError(error),
        authRequired: isHulyAuthRequiredError(error)
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={mission !== null} onOpenChange={(next) => !applying && onOpenChange(next)}>
      <DialogContent className="max-w-lg sm:max-w-lg" scrollable>
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.sidebar.MissionHulyRefreshDialog.title',
              'Refresh from Huly'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mission?.source?.milestoneLabel ?? mission?.name}
          </DialogDescription>
        </DialogHeader>
        {diffState.state === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate(
              'auto.components.sidebar.MissionHulyRefreshDialog.loading',
              'Comparing with Huly...'
            )}
          </div>
        ) : authRequired ? null : diffState.state === 'error' ? (
          <p role="alert" className="text-xs text-destructive">
            {diffState.message}
          </p>
        ) : (
          <MissionHulyRefreshDiffView diff={diffState.diff} repoNameById={repoNameById} />
        )}
        {authRequired ? <HulyReconnectNotice onReconnected={reloadAfterReconnect} /> : null}
        {current?.applyError && !authRequired ? (
          <p role="alert" className="text-xs text-destructive">
            {current.applyError}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={applying}
            onClick={() => onOpenChange(false)}
          >
            {translate('auto.components.sidebar.MissionHulyRefreshDialog.close', 'Close')}
          </Button>
          {appendableCount > 0 && !authRequired ? (
            <Button type="button" size="sm" disabled={applying} onClick={() => void handleAppend()}>
              {applying ? <Loader2 className="size-4 animate-spin" /> : null}
              {appendableCount === 1
                ? translate(
                    'auto.components.sidebar.MissionHulyRefreshDialog.appendOne',
                    'Append 1 new task'
                  )
                : translate(
                    'auto.components.sidebar.MissionHulyRefreshDialog.appendMany',
                    'Append {{count}} new tasks',
                    { count: appendableCount }
                  )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
