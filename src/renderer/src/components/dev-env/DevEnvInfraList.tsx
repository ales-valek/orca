import { translate } from '@/i18n/i18n'
import React from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { runDevEnvAction } from './dev-env-actions'
import { getDevEnvInfraTone } from './dev-env-labels'
import { DevEnvStatusDot } from './DevEnvStatusDot'

function SectionLabel({
  children,
  aside
}: {
  children: React.ReactNode
  aside?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 pt-2 pb-1">
      <span className="flex-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </span>
      {aside}
    </div>
  )
}

export function DevEnvInfraList(): React.JSX.Element {
  const infra = useAppStore((s) => s.devEnvInfra)
  const fetchDevEnvInfra = useAppStore((s) => s.fetchDevEnvInfra)
  const services = infra?.services ?? []
  const running = services.filter((service) => service.status === 'running').length
  const start = (service: string): void => {
    void runDevEnvAction(
      translate('devEnv.infra.startFailed', 'Could not start infra'),
      async () => {
        const result = await window.api.devEnv.infraUp({ service })
        if (!result.ok) {
          throw new Error(result.error ?? service)
        }
        await fetchDevEnvInfra()
      }
    )
  }
  return (
    <section>
      <SectionLabel
        aside={
          services.length > 0 ? (
            <span className="text-2xs text-muted-foreground">
              {running}/{services.length}
            </span>
          ) : null
        }
      >
        {translate('devEnv.infra.title', 'Shared infra')}
      </SectionLabel>
      {infra?.error ? (
        <div className="flex flex-col gap-1.5 px-2 py-1 text-xs text-destructive">
          <span>{infra.error}</span>
          <Button
            variant="outline"
            size="xs"
            className="self-start"
            onClick={() => void fetchDevEnvInfra()}
          >
            {translate('devEnv.infra.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
      {!infra?.error && services.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {translate('devEnv.infra.none', 'No infra services configured.')}
        </p>
      ) : null}
      {services.map((service) => (
        <div
          key={service.name}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-accent"
        >
          <DevEnvStatusDot tone={getDevEnvInfraTone(service.status)} />
          <span
            className={
              service.status === 'running'
                ? 'flex-1 truncate'
                : 'flex-1 truncate text-muted-foreground'
            }
          >
            {service.name}
          </span>
          {service.status === 'running' ? (
            <span className="font-mono text-xs text-muted-foreground">
              {service.ports[0] ?? ''}
            </span>
          ) : (
            <Button variant="outline" size="xs" onClick={() => start(service.name)}>
              {translate('devEnv.infra.start', 'Start')}
            </Button>
          )}
        </div>
      ))}
    </section>
  )
}

export { SectionLabel as DevEnvSectionLabel }
