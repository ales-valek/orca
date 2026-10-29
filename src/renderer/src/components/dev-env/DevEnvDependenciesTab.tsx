import { translate } from '@/i18n/i18n'
import React from 'react'
import { useAppStore } from '@/store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { DevEnvDetail, DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'
import { runDevEnvAction } from './dev-env-actions'
import { getDevEnvDependencyStateLabel, type DevEnvTone } from './dev-env-labels'
import { getDevEnvProviders } from './dev-env-providers'
import { DevEnvSectionLabel } from './DevEnvInfraList'
import { DevEnvStatusDot } from './DevEnvStatusDot'

const NONE = '__none__'

const NO_TEMPLATES: readonly DevEnvTemplate[] = []
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

export function DevEnvDependenciesTab({ detail }: { detail: DevEnvDetail }): React.JSX.Element {
  const envs = useAppStore((s) => s.devEnvs)
  const templates = useAppStore((s) => s.settings?.devEnvTemplates) ?? NO_TEMPLATES
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
        const bound = binding?.kind === 'local' ? binding.devEnvId : undefined
        return (
          <div key={dependency} className="flex items-center gap-3 px-2 py-1 text-[13px]">
            <DevEnvStatusDot
              tone={DEPENDENCY_TONE[detail.dependencyStates[dependency] ?? 'unbound']}
            />
            <span className="w-32 shrink-0 font-mono text-xs">{dependency}</span>
            <span className="flex-1 text-xs text-muted-foreground">
              {getDevEnvDependencyStateLabel(detail.dependencyStates[dependency] ?? 'unbound')}
            </span>
            <Select
              value={bound ?? NONE}
              onValueChange={(value) =>
                void runDevEnvAction(
                  translate('devEnv.deps.bindFailed', 'Could not pair the dependency'),
                  () =>
                    window.api.devEnv.bind({
                      env: detail.key,
                      dependency,
                      provider: value === NONE ? null : value
                    })
                )
              }
            >
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
              </SelectContent>
            </Select>
          </div>
        )
      })}
      <p className="px-2 pt-2 text-xs text-muted-foreground">
        {translate(
          'devEnv.deps.remoteLater',
          'Dev, staging and prod targets come in a later delivery.'
        )}
      </p>
      <SlotRows detail={detail} />
    </div>
  )
}
