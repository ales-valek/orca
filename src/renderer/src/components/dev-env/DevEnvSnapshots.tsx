import { translate } from '@/i18n/i18n'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBytes } from '../../../../shared/format-bytes'
import {
  DEV_ENV_NAME_PATTERN,
  type DevEnvDetail,
  type DevEnvSnapshot
} from '../../../../shared/dev-env/dev-env-types'
import { runDevEnvAction } from './dev-env-actions'
import { DevEnvConfirmDialog } from './DevEnvConfirmDialog'

type PendingAction = { kind: 'restore' | 'delete'; snapshot: DevEnvSnapshot }

export function DevEnvSnapshots({ detail }: { detail: DevEnvDetail }): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const isNameValid = DEV_ENV_NAME_PATTERN.test(name)
  const run = (label: string, action: () => Promise<unknown>): void => {
    setBusy(true)
    void runDevEnvAction(label, action).finally(() => setBusy(false))
  }
  const save = (): void =>
    run(translate('devEnv.snapshots.saveFailed', 'Could not save the snapshot'), async () => {
      await window.api.devEnv.snapshot({ env: detail.key, name })
      setName('')
    })
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-[13px]">
      <div className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {translate('devEnv.snapshots.title', 'Snapshots')}
      </div>
      {detail.snapshots.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('devEnv.snapshots.empty', 'No snapshots yet.')}
        </p>
      ) : (
        detail.snapshots.map((snapshot) => (
          <div key={snapshot.name} className="flex items-center gap-2 py-1">
            <span className="font-mono">{snapshot.name}</span>
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {new Date(snapshot.createdAt).toLocaleString()} · {formatBytes(snapshot.sizeBytes)}
              {' · '}
              {snapshot.services.join(', ')}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || detail.setupRunning}
              onClick={() => setPending({ kind: 'restore', snapshot })}
            >
              {translate('devEnv.snapshots.restore', 'Restore…')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPending({ kind: 'delete', snapshot })}
            >
              {translate('devEnv.snapshots.delete', 'Delete…')}
            </Button>
          </div>
        ))
      )}
      <div className="mt-3 flex gap-2">
        <Input
          value={name}
          placeholder={translate('devEnv.snapshots.namePlaceholder', 'before-import')}
          aria-label={translate('devEnv.snapshots.name', 'Snapshot name')}
          onChange={(event) => setName(event.target.value)}
          className="h-8 max-w-56 font-mono"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!isNameValid || busy || detail.setupRunning}
          onClick={save}
        >
          {translate('devEnv.snapshots.save', 'Save snapshot')}
        </Button>
      </div>
      {name && !isNameValid ? (
        <p className="mt-1 text-xs text-destructive">
          {translate('devEnv.snapshots.nameHint', 'Use lowercase letters, digits and dashes.')}
        </p>
      ) : null}
      <DevEnvConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === 'restore'
            ? translate('devEnv.snapshots.restoreTitle', 'Restore snapshot')
            : translate('devEnv.snapshots.deleteTitle', 'Delete snapshot')
        }
        body={
          pending?.kind === 'restore'
            ? translate(
                'devEnv.snapshots.restoreBody',
                'Stops the services of {env}, replaces its data with {snapshot}, then starts the services that were up.'
              )
                .replace('{env}', detail.name)
                .replace('{snapshot}', pending.snapshot.name)
            : translate(
                'devEnv.snapshots.deleteBody',
                'Deletes the snapshot files of {snapshot}.'
              ).replace('{snapshot}', pending?.snapshot.name ?? '')
        }
        confirmLabel={
          pending?.kind === 'restore'
            ? translate('devEnv.snapshots.restoreConfirm', 'Restore')
            : translate('devEnv.snapshots.deleteConfirm', 'Delete')
        }
        onConfirm={() => {
          if (!pending) {
            return
          }
          const args = { env: detail.key, name: pending.snapshot.name, confirm: true as const }
          if (pending.kind === 'restore') {
            run(translate('devEnv.snapshots.restoreFailed', 'Could not restore the snapshot'), () =>
              window.api.devEnv.restore(args)
            )
          } else {
            run(translate('devEnv.snapshots.deleteFailed', 'Could not delete the snapshot'), () =>
              window.api.devEnv.deleteSnapshot(args)
            )
          }
        }}
      />
    </div>
  )
}
