import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatHulyError } from '@/components/huly-error-copy'
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
import type { Mission } from '../../../../shared/mission-types'
import { getAppendableCount, MissionHulyRefreshDiffView } from './MissionHulyRefreshDiffView'

type DiffState =
  | { state: 'loading' }
  | { state: 'ready'; diff: HulyMissionRefreshDiff }
  | { state: 'error'; message: string }

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
  const [diffState, setDiffState] = useState<DiffState>({ state: 'loading' })
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const missionId = mission?.id ?? null

  useEffect(() => {
    if (!missionId) {
      return
    }
    let cancelled = false
    setDiffState({ state: 'loading' })
    setApplyError(null)
    refreshMissionFromHuly(missionId, false).then(
      (result) => {
        if (!cancelled) {
          setDiffState({ state: 'ready', diff: result.diff })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setDiffState({ state: 'error', message: formatHulyError(error) })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [missionId, refreshMissionFromHuly])

  const appendableCount = diffState.state === 'ready' ? getAppendableCount(diffState.diff) : 0

  async function handleAppend(): Promise<void> {
    if (!missionId) {
      return
    }
    setApplying(true)
    setApplyError(null)
    try {
      const result = await refreshMissionFromHuly(missionId, true)
      const message =
        result.applied.length === 1
          ? translate(
              'auto.components.sidebar.MissionHulyRefreshDialog.appendedOne',
              'Appended 1 new task'
            )
          : translate(
              'auto.components.sidebar.MissionHulyRefreshDialog.appendedMany',
              'Appended {{count}} new tasks',
              { count: result.applied.length }
            )
      if (result.warnings.length > 0) {
        toast.warning(message, { description: result.warnings.join('\n') })
      } else {
        toast.success(message)
      }
      onOpenChange(false)
    } catch (error) {
      setApplyError(formatHulyError(error))
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
        ) : diffState.state === 'error' ? (
          <p role="alert" className="text-xs text-destructive">
            {diffState.message}
          </p>
        ) : (
          <MissionHulyRefreshDiffView diff={diffState.diff} repoNameById={repoNameById} />
        )}
        {applyError ? (
          <p role="alert" className="text-xs text-destructive">
            {applyError}
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
          {appendableCount > 0 ? (
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
