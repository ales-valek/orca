import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { missionSlotErrorKey } from '@/store/slices/mission-stack-actions'
import type { Mission, MissionAbsorbResult } from '../../../../shared/mission-types'
import { formatMissionMemberError } from './mission-member-error-copy'

export type MissionAbsorbHunk = MissionAbsorbResult['ambiguous'][number]

/** Override key the absorb operation expects for an ambiguous hunk. */
function getHunkKey(hunk: Pick<MissionAbsorbHunk, 'file' | 'line'>): string {
  return `${hunk.file}:${hunk.line}`
}

/** Asks which layer takes each ambiguous preview hunk, then re-runs absorb with those choices. */
export function MissionAbsorbDialog({
  mission,
  repoId,
  hunks,
  onResolved,
  onOpenChange
}: {
  mission: Mission
  repoId: string
  /** Null keeps the dialog closed. */
  hunks: MissionAbsorbHunk[] | null
  /** Called with the hunks still ambiguous after a re-run; empty when absorb finished. */
  onResolved: (result: MissionAbsorbResult) => void
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const absorbMissionPreview = useAppStore((s) => s.absorbMissionPreview)
  const error = useAppStore(
    (s) => s.missionSlotErrors[missionSlotErrorKey(mission.id, repoId, 'preview')]
  )
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const taskById = new Map((mission.tasks ?? []).map((task) => [task.id, task]))
  const canSubmit = !submitting && (hunks ?? []).every((hunk) => Boolean(choices[getHunkKey(hunk)]))

  function close(): void {
    setChoices({})
    onOpenChange(false)
  }

  async function handleAbsorb(): Promise<void> {
    if (!canSubmit || !hunks) {
      return
    }
    setSubmitting(true)
    const overrides = Object.fromEntries(
      hunks.map((hunk) => [getHunkKey(hunk), choices[getHunkKey(hunk)]])
    )
    const result = await absorbMissionPreview(mission.id, repoId, overrides)
    setSubmitting(false)
    if (result) {
      onResolved(result)
    }
  }

  return (
    <Dialog
      open={hunks !== null}
      onOpenChange={(next) => {
        if (!next && !submitting) {
          close()
        }
      }}
    >
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.sidebar.MissionAbsorbDialog.1b2ad78b4d',
              'Choose Task Layers'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.sidebar.MissionAbsorbDialog.7f655cbe89',
              'These preview edits touch lines owned by more than one task. Pick the task that takes each edit. Nothing is absorbed until every edit has a task.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto scrollbar-sleek">
          {(hunks ?? []).map((hunk) => {
            const key = getHunkKey(hunk)
            return (
              <div key={key} className="flex min-w-0 items-center gap-2">
                {/* Why: long paths truncate, but the line number must stay visible. */}
                <code className="flex min-w-0 flex-1 font-mono text-xs" title={key}>
                  <span className="truncate">{hunk.file}</span>
                  <span className="shrink-0">:{hunk.line}</span>
                </code>
                <Select
                  value={choices[key] ?? ''}
                  onValueChange={(taskId) => setChoices((prev) => ({ ...prev, [key]: taskId }))}
                >
                  <SelectTrigger
                    size="sm"
                    density="compact"
                    className="w-40 shrink-0"
                    aria-label={translate(
                      'auto.components.sidebar.MissionAbsorbDialog.b40fdd566e',
                      'Task for {{value0}}',
                      { value0: key }
                    )}
                  >
                    <SelectValue
                      placeholder={translate(
                        'auto.components.sidebar.MissionAbsorbDialog.9f6ad094a2',
                        'Choose task'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {hunk.candidateTaskIds.map((taskId) => {
                      const task = taskById.get(taskId)
                      return (
                        <SelectItem key={taskId} value={taskId}>
                          {task?.externalRef ?? task?.title ?? taskId}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
        {error ? (
          <p className="text-xs text-destructive">{formatMissionMemberError(error)}</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={close}>
            {translate('auto.components.sidebar.MissionAbsorbDialog.5e082e7cc4', 'Cancel')}
          </Button>
          <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void handleAbsorb()}>
            {submitting
              ? translate('auto.components.sidebar.MissionAbsorbDialog.ff7ffe51d3', 'Absorbing...')
              : translate('auto.components.sidebar.MissionAbsorbDialog.d4a0733f96', 'Absorb')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
