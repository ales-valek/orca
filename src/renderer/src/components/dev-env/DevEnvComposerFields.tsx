import { translate } from '@/i18n/i18n'
import React, { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { DevEnvSummary, DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'
import { getDevEnvProviders } from './dev-env-providers'
import { selectDevEnvs } from './DevEnvStatusBadge'
import { DevEnvTemplatePicker, useDevEnvTemplates } from './DevEnvTemplatePicker'

const NONE = '__none__'

export type DevEnvComposerValue = { templateId: string | null; bindings: Record<string, string> }

/** Services a standalone worktree of `repoId` needs from elsewhere. */
export function getStandaloneDevEnvDependencies(
  template: DevEnvTemplate,
  repoId: string
): string[] {
  const ownSlot = template.slots.find((slot) => slot.repoId === repoId)
  const fromOtherSlots = template.slots
    .filter((slot) => slot !== ownSlot)
    .flatMap((slot) => slot.services.map((service) => service.name))
  return [...new Set([...template.dependencies, ...fromOtherSlots])].sort()
}

function getDefaultProvider(providers: readonly DevEnvSummary[]): string | undefined {
  return providers.find((provider) => provider.badge.up > 0)?.id
}

/** Template picker plus dependency pairing for a new standalone worktree. */
export function DevEnvComposerFields({
  repoId,
  value,
  onChange
}: {
  repoId: string | null
  value: DevEnvComposerValue
  onChange: (value: DevEnvComposerValue) => void
}): React.JSX.Element | null {
  const templates = useDevEnvTemplates()
  const envs = useAppStore(selectDevEnvs)
  const template = templates.find((entry) => entry.id === value.templateId)
  const dependencies = useMemo(
    () => (template && repoId ? getStandaloneDevEnvDependencies(template, repoId) : []),
    [template, repoId]
  )
  useEffect(() => {
    if (!template) {
      return
    }
    const defaults: Record<string, string> = {}
    for (const dependency of dependencies) {
      const provider = getDefaultProvider(getDevEnvProviders(envs, templates, dependency))
      if (provider) {
        defaults[dependency] = provider
      }
    }
    onChange({ templateId: template.id, bindings: defaults })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- defaults are picked once per template or repo; later edits stay the user's.
  }, [template?.id, repoId])

  if (!repoId) {
    return null
  }
  return (
    <div className="space-y-2">
      <DevEnvTemplatePicker
        value={value.templateId}
        onChange={(templateId) => onChange({ templateId, bindings: {} })}
      />
      {dependencies.length > 0 ? (
        <div className="space-y-1">
          <Label variant="settings">
            {translate('devEnv.composer.dependencies', 'Dependencies')}
          </Label>
          {dependencies.map((dependency) => {
            const providers = getDevEnvProviders(envs, templates, dependency)
            return (
              <div key={dependency} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 font-mono">{dependency}</span>
                <Select
                  value={value.bindings[dependency] ?? NONE}
                  onValueChange={(next) => {
                    const bindings = { ...value.bindings }
                    if (next === NONE) {
                      delete bindings[dependency]
                    } else {
                      bindings[dependency] = next
                    }
                    onChange({ ...value, bindings })
                  }}
                >
                  <SelectTrigger size="sm" className="flex-1">
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
          <p className="text-xs text-muted-foreground">
            {translate(
              'devEnv.composer.providersHint',
              'Local environments that provide the service. Bind dev, staging or prod in its Dependencies tab once it exists.'
            )}
          </p>
        </div>
      ) : null}
    </div>
  )
}
