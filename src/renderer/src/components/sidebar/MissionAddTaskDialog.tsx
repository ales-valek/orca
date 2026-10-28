import React, { useId, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { Mission } from '../../../../shared/mission-types'
import { formatMissionMemberError } from './mission-member-error-copy'

/** Appends a task layer on top of one repo's stack. */
export function MissionAddTaskDialog({
  mission,
  repoId,
  repoName,
  open,
  onOpenChange
}: {
  mission: Mission
  repoId: string
  repoName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const addMissionTask = useAppStore((s) => s.addMissionTask)
  const titleId = useId()
  const refId = useId()
  const [title, setTitle] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSubmit = title.trim().length > 0 && !submitting

  function close(): void {
    setTitle('')
    setExternalRef('')
    setError(null)
    setSubmitting(false)
    onOpenChange(false)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await addMissionTask(mission.id, repoId, {
      title: title.trim(),
      ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {})
    })
    setSubmitting(false)
    if (!result) {
      setError(
        translate(
          'auto.components.sidebar.MissionAddTaskDialog.4d09a9a0ed',
          'Could not add the task. Try again.'
        )
      )
      return
    }
    if (result.error) {
      setError(formatMissionMemberError(result.error))
      return
    }
    if (result.warning) {
      toast.warning(formatMissionMemberError(result.warning))
    }
    close()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) {
          close()
        }
      }}
    >
      <DialogContent className="max-w-sm sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('auto.components.sidebar.MissionAddTaskDialog.de2ee3046d', 'Add Task')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.sidebar.MissionAddTaskDialog.5f616845f8',
              'The task gets its own branch and workspace on top of the {{value0}} stack.',
              { value0: repoName }
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-1">
            <Label htmlFor={titleId}>
              {translate('auto.components.sidebar.MissionAddTaskDialog.f078e5c302', 'Title')}
            </Label>
            <Input
              id={titleId}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={refId}>
              {translate(
                'auto.components.sidebar.MissionAddTaskDialog.46e5204bbf',
                'Tracker key (optional)'
              )}
            </Label>
            <Input
              id={refId}
              value={externalRef}
              onChange={(event) => setExternalRef(event.target.value)}
              variant="code"
              className="h-8"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={close}>
              {translate('auto.components.sidebar.MissionAddTaskDialog.db438f7de9', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {submitting
                ? translate('auto.components.sidebar.MissionAddTaskDialog.13921025b4', 'Adding...')
                : translate('auto.components.sidebar.MissionAddTaskDialog.de2ee3046d', 'Add Task')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
