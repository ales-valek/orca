import React, { useEffect, useState } from 'react'
import { ArrowUpRight, ExternalLink, Play, Square } from 'lucide-react'
import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { openDevEnvUrl, runDevEnvAction } from './dev-env-actions'
import { getDevEnvServiceTone, t } from './dev-env-labels'
import { DevEnvSectionLabel } from './DevEnvInfraList'
import { findDevEnvForWorktree } from './DevEnvStatusBadge'
import { DevEnvStatusDot } from './DevEnvStatusDot'

const PANEL_POLL_MS = 3000

function CreateForWorktree({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const templates = useAppStore((s) => s.settings?.devEnvTemplates)
  const [templateId, setTemplateId] = useState<string | undefined>(undefined)
  if (!templates || templates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('panel.noTemplates', 'Add a Dev Environment template in Settings first.')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {t('panel.none', 'This worktree has no Dev Environment.')}
      </p>
      <Select value={templateId} onValueChange={setTemplateId}>
        <SelectTrigger size="sm">
          <SelectValue placeholder={t('panel.pickTemplate', 'Template…')} />
        </SelectTrigger>
        <SelectContent>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!templateId}
        onClick={() =>
          void runDevEnvAction(
            t('panel.createFailed', 'Could not create the Dev Environment'),
            async () => {
              await window.api.devEnv.create({ worktree: worktreeId, template: templateId ?? '' })
              await useAppStore.getState().fetchDevEnvs()
            }
          )
        }
      >
        {t('panel.create', 'Create')}
      </Button>
    </div>
  )
}

export default function DevEnvSidebarPanel(): React.JSX.Element {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const summary = useAppStore((s) =>
    worktreeId ? findDevEnvForWorktree(s.devEnvs, worktreeId) : undefined
  )
  const detail = useAppStore((s) => (summary ? s.devEnvDetails[summary.id] : undefined))
  const refreshDevEnv = useAppStore((s) => s.refreshDevEnv)
  const openDevEnvsPage = useAppStore((s) => s.openDevEnvsPage)
  const envId = summary?.id
  useEffect(() => {
    if (!envId) {
      return
    }
    void refreshDevEnv(envId)
    const timer = setInterval(() => void refreshDevEnv(envId), PANEL_POLL_MS)
    return () => clearInterval(timer)
  }, [envId, refreshDevEnv])

  if (!worktreeId) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {t('panel.noWorktree', 'Select a worktree.')}
      </p>
    )
  }
  if (!summary) {
    return (
      <div className="p-3">
        <CreateForWorktree worktreeId={worktreeId} />
      </div>
    )
  }
  const env = summary.key
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 truncate text-sm font-semibold">{t('panel.title', 'Dev Env')}</span>
        <Button variant="ghost" size="xs" onClick={() => openDevEnvsPage(summary.id)}>
          {t('panel.openPage', 'Open page')}
          <ArrowUpRight />
        </Button>
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-[13px] font-medium">{summary.name}</span>
          <Badge variant="secondary">{summary.templateName}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('panel.ports', 'ports')} {summary.portRange.first}–{summary.portRange.last}
        </p>
        {(detail?.services ?? [])
          .filter((service) => service.status !== 'unbound')
          .map((service) => {
            const worktree = summary.slotWorktrees[service.slot]
            return (
              <div key={service.name} className="flex items-center gap-2 py-0.5 text-xs">
                <DevEnvStatusDot tone={getDevEnvServiceTone(service.status)} />
                <span className="flex-1 truncate">{service.name}</span>
                <span className="font-mono text-muted-foreground">{service.port}</span>
                {service.status === 'up' && service.url && worktree ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => openDevEnvUrl(worktree.worktreeId, service.url ?? '')}
                  >
                    <ExternalLink />
                  </Button>
                ) : null}
              </div>
            )
          })}
        {detail && detail.requiredDependencies.length > 0 ? (
          <>
            <DevEnvSectionLabel>{t('panel.dependencies', 'Dependencies')}</DevEnvSectionLabel>
            {detail.requiredDependencies.map((dependency) => (
              <div key={dependency} className="flex items-center gap-2 py-0.5 text-xs">
                <span className="flex-1 truncate">{dependency}</span>
                <span className="text-muted-foreground">
                  {detail.dependencyStates[dependency] ?? 'unbound'}
                </span>
              </div>
            ))}
          </>
        ) : null}
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void runDevEnvAction(t('page.stopFailed', 'Could not stop services'), () =>
                window.api.devEnv.down({ env })
              )
            }
          >
            <Square />
            {t('panel.stop', 'Stop')}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void runDevEnvAction(t('page.startFailed', 'Could not start services'), () =>
                window.api.devEnv.up({ env })
              )
            }
          >
            <Play />
            {t('panel.start', 'Start')}
          </Button>
        </div>
      </div>
    </div>
  )
}
