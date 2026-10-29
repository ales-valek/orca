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
import type { DevEnvRemoteTier } from '../../../../shared/dev-env/dev-env-types'
import { runDevEnvAction } from './dev-env-actions'
import { splitDevEnvBindings } from './dev-env-providers'
import { DevEnvComposerFields, type DevEnvComposerValue } from './DevEnvComposerFields'
import { DevEnvTemplatePicker } from './DevEnvTemplatePicker'

export type DevEnvCreateTarget =
  | { kind: 'mission'; missionId: string; name: string; repoIds: readonly string[] }
  | { kind: 'worktree'; worktreeId: string; name: string; repoId: string }

const NO_TIERS: readonly DevEnvRemoteTier[] = []

async function createDevEnv(target: DevEnvCreateTarget, value: DevEnvComposerValue): Promise<void> {
  const api = window.api.devEnv
  const template = value.templateId ?? ''
  if (target.kind === 'mission') {
    await api.create({ mission: `id:${target.missionId}`, template })
    return
  }
  const { local, remote } = splitDevEnvBindings(value.bindings)
  const env = await api.create({ worktree: `id:${target.worktreeId}`, template, bindings: local })
  for (const binding of remote) {
    await api.bindRemote({ env: env.key, dependency: binding.dependency, tierId: binding.tierId })
  }
  if (remote.length > 0) {
    // Why: the first setup stops at env while remote dependencies are still unbound.
    await api.setup({ env: env.key })
  }
}

/** Template pick for a mission or worktree that has no Dev Environment yet. */
export function DevEnvCreateDialog({
  open,
  onOpenChange,
  target
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: DevEnvCreateTarget
}): React.JSX.Element {
  const [value, setValue] = useState<DevEnvComposerValue>({ templateId: null, bindings: {} })
  const [creating, setCreating] = useState(false)
  const tiers = useAppStore((s) => s.settings?.devEnvRemoteTiers) ?? NO_TIERS
  const create = (): void => {
    if (!value.templateId) {
      return
    }
    setCreating(true)
    void runDevEnvAction(
      translate('devEnv.create.failed', 'Could not create the Dev Environment'),
      async () => {
        await createDevEnv(target, value)
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
              { name: target.name }
            )}
          </DialogDescription>
        </DialogHeader>
        {target.kind === 'mission' ? (
          <DevEnvTemplatePicker
            value={value.templateId}
            onChange={(templateId) => setValue({ templateId, bindings: {} })}
            repoIds={target.repoIds}
          />
        ) : (
          <DevEnvComposerFields
            repoId={target.repoId}
            value={value}
            onChange={setValue}
            remoteTiers={tiers}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('devEnv.create.cancel', 'Cancel')}
          </Button>
          <Button disabled={!value.templateId || creating} onClick={create}>
            {translate('devEnv.create.confirm', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
