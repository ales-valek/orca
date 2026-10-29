import { translate } from '@/i18n/i18n'
import React, { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  normalizeDevEnvSettings,
  parseDevEnvTemplateJson,
  serializeDevEnvTemplate
} from '../../../../../shared/dev-env/dev-env-settings'
import type { DevEnvTemplate } from '../../../../../shared/dev-env/dev-env-types'
import { createDevEnvTemplate } from './dev-env-template-edit'
import { DevEnvInfraEditor } from './DevEnvInfraEditor'
import { DevEnvSecretsEditor } from './DevEnvSecretsEditor'
import { DevEnvTemplateEditor } from './DevEnvTemplateEditor'

const NO_TEMPLATES: readonly DevEnvTemplate[] = []
const HEADING = 'mb-2 text-sm font-semibold'

function newTemplateId(): string {
  return `tpl-${createBrowserUuid().slice(0, 8)}`
}

export function DevEnvSettingsPane(): React.JSX.Element {
  const templates = useAppStore((s) => s.settings?.devEnvTemplates) ?? NO_TEMPLATES
  const proxyPort = useAppStore((s) => s.settings?.devEnvProxyPort ?? 80)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0]

  const saveTemplates = (next: DevEnvTemplate[]): void => {
    const normalized = normalizeDevEnvSettings({ devEnvTemplates: next }, 'darwin').devEnvTemplates
    if (normalized.length !== next.length) {
      toast.warning(
        translate(
          'devEnv.settings.invalidTemplate',
          'An invalid template was not saved (check names and duplicate service names).'
        )
      )
    }
    void updateSettings({ devEnvTemplates: normalized })
  }
  const addTemplate = (template: DevEnvTemplate): void => {
    saveTemplates([...templates, template])
    setSelectedId(template.id)
  }
  const importTemplate = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    void file?.text().then((text) => {
      const result = parseDevEnvTemplateJson(text)
      if ('error' in result) {
        toast.error(translate('devEnv.settings.importFailed', 'Could not import the template'), {
          description: result.error
        })
        return
      }
      const clash = templates.some((template) => template.id === result.template.id)
      addTemplate(clash ? { ...result.template, id: newTemplateId() } : result.template)
    })
  }

  return (
    <div className="space-y-6">
      <section>
        <div className={HEADING}>
          {translate('devEnv.settings.proxyPort', 'Hostname proxy port')}
        </div>
        <div className="flex items-center gap-2">
          <Input
            variant="code"
            className="h-8 w-28"
            type="number"
            min={1}
            max={65535}
            defaultValue={proxyPort}
            key={proxyPort}
            onBlur={(event) => {
              const port = Number(event.target.value)
              if (Number.isInteger(port) && port > 0 && port < 65536 && port !== proxyPort) {
                void updateSettings({ devEnvProxyPort: port })
              }
            }}
          />
          <span className="text-xs text-muted-foreground">
            {translate(
              'devEnv.settings.proxyHelp',
              'Service hostnames like admin.<env>.orca.localhost are served on this port. Applies after restarting Orca.'
            )}
          </span>
        </div>
      </section>
      <section>
        <div className={HEADING}>{translate('devEnv.settings.infra', 'Shared infra')}</div>
        <DevEnvInfraEditor />
      </section>
      <section>
        <div className={HEADING}>{translate('devEnv.settings.secrets', 'Secrets')}</div>
        <DevEnvSecretsEditor />
      </section>
      <section>
        <div className={HEADING}>{translate('devEnv.settings.templates', 'Templates')}</div>
        <div className="flex gap-4">
          <div className="w-48 shrink-0 space-y-0.5">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedId(template.id)}
                className={cn(
                  'block w-full truncate rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent',
                  template === selected && 'bg-accent'
                )}
              >
                {template.name}
              </button>
            ))}
            <div className="flex flex-col gap-1 pt-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  addTemplate(
                    createDevEnvTemplate(
                      newTemplateId(),
                      translate('devEnv.settings.newTemplate', 'New template')
                    )
                  )
                }
              >
                <Plus />
                {translate('devEnv.settings.new', 'New')}
              </Button>
              <Button variant="outline" size="xs" asChild>
                <label className="cursor-pointer">
                  {translate('devEnv.settings.importJson', 'Import JSON')}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={importTemplate}
                  />
                </label>
              </Button>
            </div>
          </div>
          {selected ? (
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    addTemplate({ ...selected, id: newTemplateId(), name: `${selected.name} copy` })
                  }
                >
                  {translate('devEnv.settings.duplicate', 'Duplicate')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(serializeDevEnvTemplate(selected))
                    toast.success(
                      translate('devEnv.settings.exported', 'Template JSON copied to the clipboard')
                    )
                  }}
                >
                  <Copy />
                  {translate('devEnv.settings.exportJson', 'Export JSON')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    saveTemplates(templates.filter((template) => template.id !== selected.id))
                  }
                >
                  <Trash2 />
                  {translate('devEnv.settings.deleteTemplate', 'Delete')}
                </Button>
              </div>
              <DevEnvTemplateEditor
                template={selected}
                onSave={(next) =>
                  saveTemplates(
                    templates.map((template) => (template.id === next.id ? next : template))
                  )
                }
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'devEnv.settings.noTemplates',
                'No templates yet. Create one or import JSON.'
              )}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
