import { translate } from '@/i18n/i18n'
import React, { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  parseDevEnvTemplateJson,
  serializeDevEnvTemplate
} from '../../../../../shared/dev-env/dev-env-settings'
import type { DevEnvTemplate } from '../../../../../shared/dev-env/dev-env-types'
import { selectDevEnvs } from '@/components/dev-env/DevEnvStatusBadge'
import { createDevEnvTemplate, replaceDevEnvTemplate } from './dev-env-template-edit'
import { DevEnvJsonSettingEditor } from './DevEnvJsonSettingEditor'
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

  const envs = useAppStore(selectDevEnvs)
  const [deleteOpen, setDeleteOpen] = useState(false)
  /** Writes one template; an invalid draft is refused and the saved list stays as it was. */
  const saveTemplate = (template: DevEnvTemplate): boolean => {
    const result = replaceDevEnvTemplate(templates, template)
    if ('error' in result) {
      toast.error(translate('devEnv.settings.invalidTemplate', 'The template was not saved'), {
        description: result.error
      })
      return false
    }
    void updateSettings({ devEnvTemplates: result.templates })
    return true
  }
  const addTemplate = (template: DevEnvTemplate): void => {
    if (saveTemplate(template)) {
      setSelectedId(template.id)
    }
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
        <DevEnvJsonSettingEditor
          field="devEnvInfra"
          help={translate(
            'devEnv.infra.help',
            'Each service: name, image or build, ports [{name, host, container}], environment, volumes, healthcheck, resource {create, drop, dump, restore}. Resource commands run inside the container for each environment and must be safe to run twice; dump writes the data to stdout and restore reads it from stdin.'
          )}
          saveLabel={translate('devEnv.infra.save', 'Save infra')}
          importLabel={translate('devEnv.infra.import', 'Import infra JSON')}
        />
      </section>
      <section>
        <div className={HEADING}>{translate('devEnv.settings.remoteTiers', 'Remote tiers')}</div>
        <DevEnvJsonSettingEditor
          field="devEnvRemoteTiers"
          help={translate(
            'devEnv.tiers.help',
            'Each tier: id, name, danger (true for prod), dependencies {<service>: {url, values {<export>: value}}}. Values may use ${secret.<name>} and stay masked. Tiers are bound only from this desktop app; a danger tier asks for the environment key.'
          )}
          saveLabel={translate('devEnv.tiers.save', 'Save tiers')}
          importLabel={translate('devEnv.tiers.import', 'Import tiers JSON')}
        />
      </section>
      <section>
        <div className={HEADING}>{translate('devTools.settings.title', 'Tools')}</div>
        <DevEnvJsonSettingEditor
          field="devEnvTools"
          help={translate(
            'devTools.settings.help',
            'Data tools on the Tools page. Container tool: {kind: adminer | redisinsight | bullmq-dashboard | s3-browser, name, label, port (1024–65535 on 127.0.0.1), infraService}. Link to an infra UI: {kind: link, name, label, infraService, portName, path?}. Passwords come from the infra definition.'
          )}
          saveLabel={translate('devTools.settings.save', 'Save tools')}
          importLabel={translate('devTools.settings.import', 'Import tools JSON')}
        />
      </section>
      <section>
        <div className={HEADING}>{translate('testRuns.settings.title', 'Test runs')}</div>
        <DevEnvJsonSettingEditor
          field="devEnvTestRuns"
          help={translate(
            'testRuns.settings.help',
            'Env for test runs started from Orca: localEnv for Dev Environments, presets for shared environments. envFiles copies a preset\'s missing .env files from an absolute folder into the source, e.g. {"localEnv": {"TEST_ENV": "local"}, "presets": [{"name": "dev", "env": {"TEST_ENV": "dev"}, "envFiles": {"from": "/path/to/tests", "to": "tests"}}]}.'
          )}
          saveLabel={translate('testRuns.settings.save', 'Save test runs')}
          importLabel={translate('testRuns.settings.import', 'Import test runs JSON')}
        />
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
                <Button variant="ghost" size="xs" onClick={() => setDeleteOpen(true)}>
                  <Trash2 />
                  {translate('devEnv.settings.deleteTemplate', 'Delete')}
                </Button>
              </div>
              <DevEnvTemplateEditor template={selected} onSave={saveTemplate} />
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {translate('devEnv.settings.deleteTitle', 'Delete template {{name}}?', {
                        name: selected.name
                      })}
                    </DialogTitle>
                    <DialogDescription>
                      {translate(
                        'devEnv.settings.deleteBody',
                        '{{count}} Dev Environment(s) use it and will show "Template no longer exists" until you delete them.',
                        { count: envs.filter((env) => env.templateId === selected.id).length }
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
                      {translate('devEnv.settings.cancel', 'Cancel')}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setDeleteOpen(false)
                        void updateSettings({
                          devEnvTemplates: templates.filter(
                            (template) => template.id !== selected.id
                          )
                        })
                      }}
                    >
                      {translate('devEnv.settings.deleteConfirm', 'Delete template')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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
