import { translate } from '@/i18n/i18n'
import React, { useEffect, useState } from 'react'
import { Container, Play, Square } from 'lucide-react'
import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { runDevEnvAction } from './dev-env-actions'
import { DevEnvDataTab } from './DevEnvDataTab'
import { DevEnvDependenciesTab } from './DevEnvDependenciesTab'
import { DevEnvEnvTab } from './DevEnvEnvTab'
import { DevEnvInfraList } from './DevEnvInfraList'
import { DevEnvList } from './DevEnvList'
import { DevEnvServicesTab } from './DevEnvServicesTab'
import { DevEnvSetupTab } from './DevEnvSetupTab'

const POLL_MS = 3000

function useDevEnvPolling(selectedId: string | null): void {
  const fetchDevEnvs = useAppStore((s) => s.fetchDevEnvs)
  const fetchDevEnvInfra = useAppStore((s) => s.fetchDevEnvInfra)
  const refreshDevEnv = useAppStore((s) => s.refreshDevEnv)
  useEffect(() => {
    const tick = (): void => {
      void fetchDevEnvs()
      void fetchDevEnvInfra()
      if (selectedId) {
        void refreshDevEnv(selectedId)
      }
    }
    tick()
    // Why: service readiness comes from port probes, which push no change event.
    const timer = setInterval(tick, POLL_MS)
    return () => clearInterval(timer)
  }, [selectedId, fetchDevEnvs, fetchDevEnvInfra, refreshDevEnv])
}

function EmptyState(): React.JSX.Element {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Container className="size-6" />
      <p>
        {translate(
          'devEnv.page.empty',
          'No Dev Environments yet. Add a template, then pick it when you create a mission or worktree.'
        )}
      </p>
      <Button variant="outline" size="sm" onClick={() => openSettingsPage()}>
        {translate('devEnv.page.openSettings', 'Open settings')}
      </Button>
    </div>
  )
}

function DevEnvDetailPane({ envId }: { envId: string }): React.JSX.Element | null {
  const detail = useAppStore((s) => s.devEnvDetails[envId])
  const [tab, setTab] = useState('services')
  if (!detail) {
    return null
  }
  const env = detail.key
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">{detail.name}</h2>
            <Badge variant="secondary">{detail.templateName}</Badge>
            <Badge variant="secondary">
              {detail.portRange.first}–{detail.portRange.last}
            </Badge>
            {detail.detached ? <Badge variant="destructive">{detail.attachmentLabel}</Badge> : null}
            {detail.badge.danger ? (
              <Badge variant="destructive">{translate('devEnv.badge.prod', 'prod')}</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {detail.attachmentLabel} · {translate('devEnv.page.key', 'key')}{' '}
            <span className="font-mono">{detail.key}</span>
          </p>
          {detail.hostnameError ? (
            <p className="mt-1 text-xs text-destructive">{detail.hostnameError}</p>
          ) : null}
        </div>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="xs"
          value={detail.mode}
          aria-label={translate('devEnv.page.mode', 'Run mode')}
          onValueChange={(mode) => {
            if (mode === 'dev' || mode === 'prod') {
              void runDevEnvAction(
                translate('devEnv.page.modeFailed', 'Could not switch the run mode'),
                () => window.api.devEnv.mode({ env, mode })
              )
            }
          }}
        >
          <ToggleGroupItem value="dev">{translate('devEnv.page.modeDev', 'Dev')}</ToggleGroupItem>
          <ToggleGroupItem
            value="prod"
            title={translate(
              'devEnv.page.modeProdHint',
              'Runs each service’s prod build and start commands; switching stops the services.'
            )}
          >
            {translate('devEnv.page.modeProd', 'Prod build')}
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void runDevEnvAction(
              translate('devEnv.page.stopFailed', 'Could not stop services'),
              () => window.api.devEnv.down({ env })
            )
          }
        >
          <Square className="size-4" />
          {translate('devEnv.page.stopAll', 'Stop all')}
        </Button>
        <Button
          size="sm"
          disabled={detail.detached === true}
          onClick={() =>
            void runDevEnvAction(
              translate('devEnv.page.startFailed', 'Could not start services'),
              async () => {
                const result = await window.api.devEnv.up({ env })
                if (result.errors.length > 0) {
                  throw new Error(result.errors.join('\n'))
                }
              }
            )
          }
        >
          <Play className="size-4" />
          {translate('devEnv.page.startAll', 'Start all')}
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4">
          <TabsList variant="line">
            <TabsTrigger value="services">
              {translate('devEnv.tab.services', 'Services')}
            </TabsTrigger>
            <TabsTrigger value="env">{translate('devEnv.tab.env', 'Env')}</TabsTrigger>
            <TabsTrigger value="setup">{translate('devEnv.tab.setup', 'Setup')}</TabsTrigger>
            <TabsTrigger value="data">{translate('devEnv.tab.data', 'Data')}</TabsTrigger>
            <TabsTrigger value="dependencies">
              {translate('devEnv.tab.dependencies', 'Dependencies')}
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
          <TabsContent value="services">
            <DevEnvServicesTab detail={detail} onOpenDependencies={() => setTab('dependencies')} />
          </TabsContent>
          <TabsContent value="env">
            {tab === 'env' ? <DevEnvEnvTab detail={detail} /> : null}
          </TabsContent>
          <TabsContent value="setup">
            <DevEnvSetupTab detail={detail} />
          </TabsContent>
          <TabsContent value="data">
            <DevEnvDataTab detail={detail} />
          </TabsContent>
          <TabsContent value="dependencies">
            <DevEnvDependenciesTab detail={detail} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

export default function DevEnvPage(): React.JSX.Element {
  const devEnvs = useAppStore((s) => s.devEnvs)
  const selectedId = useAppStore((s) => s.selectedDevEnvId)
  const selectDevEnv = useAppStore((s) => s.selectDevEnv)
  const effectiveId =
    selectedId && devEnvs.some((env) => env.id === selectedId)
      ? selectedId
      : (devEnvs[0]?.id ?? null)
  useDevEnvPolling(effectiveId)
  useEffect(() => {
    if (effectiveId !== selectedId) {
      selectDevEnv(effectiveId)
    }
  }, [effectiveId, selectedId, selectDevEnv])

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="scrollbar-sleek flex w-60 shrink-0 flex-col gap-3 overflow-auto border-r border-border p-2">
        <DevEnvInfraList />
        <DevEnvList selectedId={effectiveId} onSelect={selectDevEnv} />
      </aside>
      {effectiveId ? <DevEnvDetailPane envId={effectiveId} /> : <EmptyState />}
    </div>
  )
}
