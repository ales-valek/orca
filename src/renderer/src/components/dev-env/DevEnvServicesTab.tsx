import React from 'react'
import { Copy, ExternalLink, RotateCw, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DEV_ENV_MASK,
  type DevEnvDetail,
  type DevEnvServiceState
} from '../../../../shared/dev-env/dev-env-types'
import { openDevEnvUrl, revealDevEnvWorktree, runDevEnvAction } from './dev-env-actions'
import { getDevEnvServiceTone, t } from './dev-env-labels'
import { DevEnvStatusDot } from './DevEnvStatusDot'

function getStatusText(service: DevEnvServiceState): string | null {
  switch (service.status) {
    case 'up':
      return null
    case 'starting':
      return t('service.starting', 'starting… waiting for the port')
    case 'crashed':
      return `${t('service.crashed', 'crashed')}${service.exitCode != null ? ` · exit ${service.exitCode}` : ''}`
    case 'moved':
      return t('service.moved', 'moved, restart needed')
    case 'unbound':
      return t('service.unbound', 'repo not in this mission')
    case 'stopped':
      return t('service.stopped', 'stopped')
  }
}

function ServiceRow({
  detail,
  service,
  onOpenDependencies
}: {
  detail: DevEnvDetail
  service: DevEnvServiceState
  onOpenDependencies: () => void
}): React.JSX.Element {
  const worktreeId = detail.slotWorktrees[service.slot]?.worktreeId
  const statusText = getStatusText(service)
  const restart = (): void => {
    void runDevEnvAction(t('service.restartFailed', 'Could not restart'), () =>
      window.api.devEnv.restart({ env: detail.key, service: service.name })
    )
  }
  return (
    <tr className="border-b border-border hover:bg-accent/40">
      <td className="px-4 py-1.5">
        <span className="flex items-center gap-2">
          <DevEnvStatusDot tone={getDevEnvServiceTone(service.status)} />
          <span className={service.status === 'unbound' ? 'text-muted-foreground' : undefined}>
            {service.name}
          </span>
        </span>
      </td>
      <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
        {service.worktreeLabel ?? '—'}
      </td>
      <td className="px-2 py-1.5 font-mono text-xs">{service.port}</td>
      <td className="px-2 py-1.5 font-mono text-xs">
        {statusText ? (
          <span
            className={service.status === 'crashed' ? 'text-destructive' : 'text-muted-foreground'}
          >
            {statusText}
          </span>
        ) : (
          (service.url ?? '—')
        )}
      </td>
      <td className="px-4 py-1.5">
        <span className="flex justify-end gap-1">
          {service.status === 'unbound' ? (
            <Button variant="outline" size="xs" onClick={onOpenDependencies}>
              {t('service.bind', 'Bind…')}
            </Button>
          ) : null}
          {service.status === 'up' && service.url && worktreeId ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => openDevEnvUrl(worktreeId, service.url ?? '')}
            >
              <ExternalLink />
              {t('service.open', 'Open')}
            </Button>
          ) : null}
          {worktreeId && service.status !== 'unbound' ? (
            <Button variant="ghost" size="xs" onClick={() => revealDevEnvWorktree(worktreeId)}>
              <ScrollText />
              {t('service.log', 'Log')}
            </Button>
          ) : null}
          {service.status !== 'unbound' ? (
            <Button variant="ghost" size="xs" onClick={restart}>
              <RotateCw />
              {service.status === 'stopped' || service.status === 'moved'
                ? t('service.start', 'Start')
                : t('service.restart', 'Restart')}
            </Button>
          ) : null}
        </span>
      </td>
    </tr>
  )
}

function CredentialsCard({ detail }: { detail: DevEnvDetail }): React.JSX.Element | null {
  if (detail.credentials.length === 0) {
    return null
  }
  const copyPassword = (label: string): void => {
    void runDevEnvAction(t('credentials.copyFailed', 'Could not copy'), async () => {
      const password = await window.api.devEnv.revealCredential({ env: detail.key, label })
      await navigator.clipboard.writeText(password)
      toast.success(t('credentials.copied', 'Password copied'))
    })
  }
  return (
    <div className="m-4 rounded-xl border border-border bg-card p-3">
      <div className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t('credentials.title', 'Logins for clicking through')}
      </div>
      {detail.credentials.map((credential) => (
        <div key={credential.label} className="flex items-center gap-3 py-0.5 text-xs">
          <span className="flex-1">{credential.label}</span>
          <span className="font-mono">{credential.user}</span>
          <span className="font-mono text-muted-foreground">
            {credential.password || DEV_ENV_MASK}
          </span>
          <Button variant="ghost" size="xs" onClick={() => copyPassword(credential.label)}>
            <Copy />
            {t('credentials.copy', 'Copy password')}
          </Button>
        </div>
      ))}
    </div>
  )
}

export function DevEnvServicesTab({
  detail,
  onOpenDependencies
}: {
  detail: DevEnvDetail
  onOpenDependencies: () => void
}): React.JSX.Element {
  return (
    <div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-1.5 font-medium">{t('service.name', 'Service')}</th>
            <th className="px-2 py-1.5 font-medium">{t('service.worktree', 'Worktree')}</th>
            <th className="px-2 py-1.5 font-medium">{t('service.port', 'Port')}</th>
            <th className="px-2 py-1.5 font-medium">URL</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {detail.services.map((service) => (
            <ServiceRow
              key={service.name}
              detail={detail}
              service={service}
              onOpenDependencies={onOpenDependencies}
            />
          ))}
        </tbody>
      </table>
      <CredentialsCard detail={detail} />
    </div>
  )
}
