import { translate } from '@/i18n/i18n'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { runDevEnvAction } from './dev-env-actions'
import { DevEnvTemplatePicker } from './DevEnvTemplatePicker'

/** Template pick for a mission that was created without a Dev Environment. */
export function DevEnvCreateDialog({
  open,
  onOpenChange,
  missionId,
  missionName,
  repoIds
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  missionId: string
  missionName: string
  repoIds: readonly string[]
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const create = (): void => {
    if (!templateId) {
      return
    }
    setCreating(true)
    void runDevEnvAction(
      translate('devEnv.create.failed', 'Could not create the Dev Environment'),
      async () => {
        await window.api.devEnv.create({ mission: `id:${missionId}`, template: templateId })
        await useAppStore.getState().fetchDevEnvs()
        onOpenChange(false)
      }
    ).finally(() => setCreating(false))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{translate('devEnv.create.title', 'Create Dev Environment')}</DialogTitle>
          <DialogDescription>
            {translate(
              'devEnv.create.description',
              'For {{name}}: env, dependencies, infra and data are set up right away.',
              { name: missionName }
            )}
          </DialogDescription>
        </DialogHeader>
        <DevEnvTemplatePicker value={templateId} onChange={setTemplateId} repoIds={repoIds} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('devEnv.create.cancel', 'Cancel')}
          </Button>
          <Button disabled={!templateId || creating} onClick={create}>
            {translate('devEnv.create.confirm', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
