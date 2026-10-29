import { translate } from '@/i18n/i18n'
import React, { useState } from 'react'
import { useAppStore } from '@/store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  DevEnvDetail,
  DevEnvRemoteTier,
  DevEnvTemplate
} from '../../../../shared/dev-env/dev-env-types'
import { runDevEnvAction } from './dev-env-actions'
import { getDevEnvDependencyStateLabel, type DevEnvTone } from './dev-env-labels'
import { getDevEnvProviders } from './dev-env-providers'
import { DevEnvConfirmDialog } from './DevEnvConfirmDialog'
import { DevEnvSectionLabel } from './DevEnvInfraList'
import { DevEnvStatusDot } from './DevEnvStatusDot'

const NONE = '__none__'

const REMOTE_PREFIX = 'remote:'

const NO_TEMPLATES: readonly DevEnvTemplate[] = []
const NO_TIERS: readonly DevEnvRemoteTier[] = []
const DEFAULT_SLOT = '__default__'

const DEPENDENCY_TONE: Record<DevEnvDetail['dependencyStates'][string], DevEnvTone> = {
  up: 'ok',
  down: 'warn',
  unbound: 'muted',
  missing: 'error',
  remote: 'info'
}

function SlotRows({ detail }: { detail: DevEnvDetail }): React.JSX.Element | null {
  const template = useAppStore((s) =>
    s.settings?.devEnvTemplates.find((entry) => entry.id === detail.templateId)
  )
  const missionId = detail.attachment.kind === 'mission' ? detail.attachment.missionId : null
  const mission = useAppStore((s) => s.missions.find((entry) => entry.id === missionId))

  if (!template) {
    return null
  }
  return (
    <section className="mt-4">
      <DevEnvSectionLabel>{translate('devEnv.deps.slots', 'Slots')}</DevEnvSectionLabel>
      {template.slots.map((slot) => {
        const layers = (mission?.tasks ?? []).filter(
          (task) => task.repoId === slot.repoId && task.worktreeId
        )
        const pinned = detail.slotPins[slot.name]
        return (
          <div key={slot.name} className="flex items-center gap-3 px-2 py-1 text-[13px]">
            <span className="w-32 shrink-0 font-mono text-xs">{slot.name}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {detail.slotWorktrees[slot.name]?.label ??
                translate('devEnv.deps.unboundSlot', 'no worktree')}
            </span>
            {mission ? (
              <Select
                value={pinned ?? DEFAULT_SLOT}
                onValueChange={(value) =>
                  void runDevEnvAction(
                    translate('devEnv.deps.pinFailed', 'Could not change the slot'),
                    () =>
                      window.api.devEnv.pinSlot({
                        env: detail.key,
                        slot: slot.name,
                        worktree: value === DEFAULT_SLOT ? null : value
                      })
                  )
                }
              >
                <SelectTrigger size="sm" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_SLOT}>
                    {translate('devEnv.deps.defaultSlot', 'Default (preview, else mission branch)')}
                  </SelectItem>
                  {layers.map((task) => (
                    <SelectItem key={task.id} value={task.worktreeId ?? ''}>
                      {task.externalRef ?? task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function bindRemoteTier(
  detail: DevEnvDetail,
  dependency: string,
  tierId: string,
  typed?: string
): void {
  void runDevEnvAction(translate('devEnv.deps.bindFailed', 'Could not pair the dependency'), () =>
    window.api.devEnv.bindRemote({ env: detail.key, dependency, tierId, confirmation: typed })
  )
}

export function DevEnvDependenciesTab({ detail }: { detail: DevEnvDetail }): React.JSX.Element {
  const envs = useAppStore((s) => s.devEnvs)
  const templates = useAppStore((s) => s.settings?.devEnvTemplates) ?? NO_TEMPLATES
  const tiers = useAppStore((s) => s.settings?.devEnvRemoteTiers) ?? NO_TIERS
  const [dangerBind, setDangerBind] = useState<{
    dependency: string
    tier: DevEnvRemoteTier
  } | null>(null)
  const choose = (dependency: string, value: string): void => {
    if (value.startsWith(REMOTE_PREFIX)) {
      const tier = tiers.find((entry) => entry.id === value.slice(REMOTE_PREFIX.length))
      if (tier?.danger) {
        setDangerBind({ dependency, tier })
      } else if (tier) {
        bindRemoteTier(detail, dependency, tier.id)
      }
      return
    }
    void runDevEnvAction(translate('devEnv.deps.bindFailed', 'Could not pair the dependency'), () =>
      window.api.devEnv.bind({
        env: detail.key,
        dependency,
        provider: value === NONE ? null : value
      })
    )
  }
  return (
    <div className="p-4">
      <DevEnvSectionLabel>{translate('devEnv.deps.title', 'Dependencies')}</DevEnvSectionLabel>
      {detail.requiredDependencies.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          {translate(
            'devEnv.deps.none',
            'Every service of this template runs in this environment.'
          )}
        </p>
      ) : null}
      {detail.requiredDependencies.map((dependency) => {
        const providers = getDevEnvProviders(envs, templates, dependency, detail.id)
        const binding = detail.bindings[dependency]
        const bound =
          binding?.kind === 'local'
            ? binding.devEnvId
            : binding?.kind === 'remote'
              ? `${REMOTE_PREFIX}${binding.tierId}`
              : undefined
        const remoteTiers = tiers.filter((tier) => tier.dependencies[dependency])
        return (
          <div key={dependency} className="flex items-center gap-3 px-2 py-1 text-[13px]">
            <DevEnvStatusDot
              tone={DEPENDENCY_TONE[detail.dependencyStates[dependency] ?? 'unbound']}
            />
            <span className="w-32 shrink-0 font-mono text-xs">{dependency}</span>
            <span className="flex-1 text-xs text-muted-foreground">
              {getDevEnvDependencyStateLabel(detail.dependencyStates[dependency] ?? 'unbound')}
            </span>
            <Select value={bound ?? NONE} onValueChange={(value) => choose(dependency, value)}>
              <SelectTrigger size="sm" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {translate('devEnv.deps.notBound', 'Not bound')}
                </SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {translate('devEnv.deps.local', 'Local')} · {provider.name}
                  </SelectItem>
                ))}
                {remoteTiers.map((tier) => (
                  <SelectItem
                    key={tier.id}
                    value={`${REMOTE_PREFIX}${tier.id}`}
                    className={tier.danger ? 'text-destructive' : undefined}
                  >
                    {translate('devEnv.deps.remote', 'Remote')} · {tier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
      {tiers.length === 0 ? (
        <p className="px-2 pt-2 text-xs text-muted-foreground">
          {translate(
            'devEnv.deps.noTiers',
            'Add dev, staging or prod targets under Settings → Dev Environments → Remote tiers.'
          )}
        </p>
      ) : null}
      <DevEnvConfirmDialog
        open={dangerBind !== null}
        onOpenChange={(open) => !open && setDangerBind(null)}
        title={translate('devEnv.deps.dangerTitle', 'Bind to {tier}').replace(
          '{tier}',
          dangerBind?.tier.name ?? ''
        )}
        body={translate(
          'devEnv.deps.dangerBody',
          '{env} will talk to {tier} for {dependency}. Type the environment key to confirm.'
        )
          .replace('{env}', detail.name)
          .replace('{tier}', dangerBind?.tier.name ?? '')
          .replace('{dependency}', dangerBind?.dependency ?? '')}
        confirmLabel={translate('devEnv.deps.dangerConfirm', 'Bind')}
        typedKey={detail.key}
        onConfirm={(typed) =>
          dangerBind && bindRemoteTier(detail, dangerBind.dependency, dangerBind.tier.id, typed)
        }
      />
      <SlotRows detail={detail} />
    </div>
  )
}
