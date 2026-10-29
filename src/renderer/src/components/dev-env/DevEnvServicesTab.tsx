import { translate } from '@/i18n/i18n'
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
import { getDevEnvServiceTone } from './dev-env-labels'
import { DevEnvStatusDot } from './DevEnvStatusDot'

function getStatusText(service: DevEnvServiceState): string | null {
  switch (service.status) {
    case 'up':
      return null
    case 'starting':
      return translate('devEnv.service.starting', 'starting… waiting for the port')
    case 'crashed':
      return `${translate('devEnv.service.crashed', 'crashed')}${service.exitCode != null ? ` · exit ${service.exitCode}` : ''}`
    case 'moved':
      return translate('devEnv.service.moved', 'moved, restart needed')
    case 'unbound':
      return translate('devEnv.service.unbound', 'repo not in this mission')
    case 'stopped':
      return translate('devEnv.service.stopped', 'stopped')
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
    void runDevEnvAction(translate('devEnv.service.restartFailed', 'Could not restart'), () =>
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
              {translate('devEnv.service.bind', 'Bind…')}
            </Button>
          ) : null}
          {service.status === 'up' && service.url && worktreeId ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => openDevEnvUrl(worktreeId, service.url ?? '')}
            >
              <ExternalLink />
              {translate('devEnv.service.open', 'Open')}
            </Button>
          ) : null}
          {worktreeId && service.status !== 'unbound' ? (
            <Button variant="ghost" size="xs" onClick={() => revealDevEnvWorktree(worktreeId)}>
              <ScrollText />
              {translate('devEnv.service.log', 'Log')}
            </Button>
          ) : null}
          {service.status !== 'unbound' ? (
            <Button variant="ghost" size="xs" onClick={restart}>
              <RotateCw />
              {service.status === 'stopped' || service.status === 'moved'
                ? translate('devEnv.service.start', 'Start')
                : translate('devEnv.service.restart', 'Restart')}
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
    void runDevEnvAction(translate('devEnv.credentials.copyFailed', 'Could not copy'), async () => {
      const password = await window.api.devEnv.revealCredential({ env: detail.key, label })
      await navigator.clipboard.writeText(password)
      toast.success(translate('devEnv.credentials.copied', 'Password copied'))
    })
  }
  return (
    <div className="m-4 rounded-xl border border-border bg-card p-3">
      <div className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {translate('devEnv.credentials.title', 'Logins for clicking through')}
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
            {translate('devEnv.credentials.copy', 'Copy password')}
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
            <th className="px-4 py-1.5 font-medium">
              {translate('devEnv.service.name', 'Service')}
            </th>
            <th className="px-2 py-1.5 font-medium">
              {translate('devEnv.service.worktree', 'Worktree')}
            </th>
            <th className="px-2 py-1.5 font-medium">{translate('devEnv.service.port', 'Port')}</th>
            <th className="px-2 py-1.5 font-medium">{translate('devEnv.service.url', 'URL')}</th>
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
