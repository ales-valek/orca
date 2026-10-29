import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import type { DevEnvDetail, DevEnvInfraService } from '../../../../shared/dev-env/dev-env-types'
import { runDevEnvAction } from './dev-env-actions'
import { t } from './dev-env-labels'

const NO_INFRA: readonly DevEnvInfraService[] = []

function ConfirmWithOption({
  open,
  onOpenChange,
  title,
  body,
  optionLabel,
  defaultOption,
  confirmLabel,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  optionLabel: string
  defaultOption: boolean
  confirmLabel: string
  onConfirm: (option: boolean) => void
}): React.JSX.Element {
  const [option, setOption] = useState(defaultOption)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <Label className="flex items-center gap-2 text-sm">
          <Checkbox checked={option} onCheckedChange={(value) => setOption(value === true)} />
          {optionLabel}
        </Label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('data.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              onConfirm(option)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DevEnvDataTab({ detail }: { detail: DevEnvDetail }): React.JSX.Element {
  const infra = useAppStore((s) => s.settings?.devEnvInfra) ?? NO_INFRA
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const resources = infra.filter((service) => service.resource).map((service) => service.name)
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded-xl border border-border bg-card p-3 text-[13px]">
        <div className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('data.title', 'Data of this environment')}
        </div>
        {resources.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('data.noResources', 'No infra service defines per-environment resources.')}
          </p>
        ) : (
          resources.map((name) => (
            <div key={name} className="py-0.5">
              {name}: <span className="font-mono">{detail.key}</span>
            </div>
          ))
        )}
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={detail.setupRunning}
            onClick={() =>
              void runDevEnvAction(t('data.seedFailed', 'Could not start the seed'), () =>
                window.api.devEnv.seed({ env: detail.key })
              )
            }
          >
            {t('data.seed', 'Seed')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={detail.setupRunning}
            onClick={() => setResetOpen(true)}
          >
            {t('data.reset', 'Reset data')}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border p-3 text-[13px]">
        <span className="flex-1 text-muted-foreground">
          {detail.detached
            ? t(
                'data.detached',
                'Its mission or worktree is gone. Delete the environment when you no longer need its data.'
              )
            : t(
                'data.deleteHint',
                'Deleting stops the services and removes the environment from Orca.'
              )}
        </span>
        <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
          {t('data.delete', 'Delete…')}
        </Button>
      </div>
      <ConfirmWithOption
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t('data.resetTitle', 'Reset data')}
        body={t('data.resetBody', 'This drops {resources} for {env} and recreates them.')
          .replace('{resources}', resources.join(', ') || t('data.allResources', 'all resources'))
          .replace('{env}', detail.name)}
        optionLabel={t('data.reseed', 'Run the seed afterwards')}
        defaultOption
        confirmLabel={t('data.reset', 'Reset data')}
        onConfirm={(reseed) =>
          void runDevEnvAction(t('data.resetFailed', 'Could not reset data'), () =>
            window.api.devEnv.reset({ env: detail.key, reseed })
          )
        }
      />
      <ConfirmWithOption
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('data.deleteTitle', 'Delete Dev Environment')}
        body={t(
          'data.deleteBody',
          'Stops the services of {env} and deletes it. Worktrees and repos stay.'
        ).replace('{env}', detail.name)}
        optionLabel={t('data.dropData', 'Also drop its data in the shared infra')}
        defaultOption={false}
        confirmLabel={t('data.deleteConfirm', 'Delete')}
        onConfirm={(dropData) =>
          void runDevEnvAction(t('data.deleteFailed', 'Could not delete'), () =>
            window.api.devEnv.delete({ env: detail.key, dropData })
          )
        }
      />
    </div>
  )
}
