import { translate } from '@/i18n/i18n'
import React from 'react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { DevEnvSummary } from '../../../../shared/dev-env/dev-env-types'
import { getDevEnvBadgeLabel } from './dev-env-labels'
import { DevEnvSectionLabel } from './DevEnvInfraList'
import { DevEnvStatusDot } from './DevEnvStatusDot'

function getSubline(env: DevEnvSummary): string {
  const failed = Object.entries(env.setup).find(([, step]) => step?.status === 'failed')
  if (failed) {
    return `${translate('devEnv.list.setupFailed', 'setup failed')}: ${failed[0]}`
  }
  return `${env.templateName} · ${env.badge.up}/${env.badge.total} ${translate('devEnv.list.services', 'services')}`
}

export function DevEnvList({
  selectedId,
  onSelect
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const envs = useAppStore((s) => s.devEnvs)
  return (
    <section>
      <DevEnvSectionLabel>{translate('devEnv.list.title', 'Environments')}</DevEnvSectionLabel>
      {envs.map((env) => (
        <button
          key={env.id}
          type="button"
          data-current={env.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(env.id)}
          className={cn(
            'flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent',
            env.id === selectedId && 'bg-accent'
          )}
        >
          <span className="flex items-center gap-2 text-[13px]">
            <DevEnvStatusDot tone={getDevEnvBadgeLabel(env.badge).tone} />
            <span className="flex-1 truncate">{env.name}</span>
            <span className="text-2xs text-muted-foreground">
              {env.attachment.kind === 'mission'
                ? translate('devEnv.list.mission', 'mission')
                : translate('devEnv.list.worktree', 'worktree')}
            </span>
          </span>
          <span className="truncate pl-4 text-xs text-muted-foreground">{getSubline(env)}</span>
        </button>
      ))}
    </section>
  )
}
