import { translate } from '@/i18n/i18n'
import React, { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type {
  DevEnvEnvFile,
  DevEnvServiceDef,
  DevEnvTemplateSlot
} from '../../../../../shared/dev-env/dev-env-types'
import { formatDevEnvEnvLines, parseDevEnvEnvLines, parseDevEnvList } from './dev-env-template-edit'

const SECTION = 'mb-1 mt-3 text-2xs font-semibold tracking-wider text-muted-foreground uppercase'

function ServiceRow({
  service,
  onChange,
  onRemove
}: {
  service: DevEnvServiceDef
  onChange: (service: DevEnvServiceDef) => void
  onRemove: () => void
}): React.JSX.Element {
  const setProd = (prod: { build: string; start: string }): void =>
    onChange({
      ...service,
      prod:
        prod.build || prod.start
          ? { ...(prod.build ? { build: prod.build } : {}), start: prod.start }
          : undefined
    })
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[8rem_1fr_3.5rem_9rem_9rem_6rem_auto] items-center gap-1.5">
        <Input
          variant="code"
          density="compact"
          value={service.name}
          onChange={(e) => onChange({ ...service, name: e.target.value })}
        />
        <Input
          variant="code"
          density="compact"
          value={service.command}
          onChange={(e) => onChange({ ...service, command: e.target.value })}
        />
        <Input
          variant="code"
          density="compact"
          type="number"
          min={0}
          max={99}
          value={service.portOffset}
          onChange={(e) => onChange({ ...service, portOffset: Number(e.target.value) })}
        />
        <Input
          variant="code"
          density="compact"
          placeholder="admin.${devEnv.key}"
          value={service.host ?? ''}
          onChange={(e) => onChange({ ...service, host: e.target.value || undefined })}
        />
        <Input
          variant="code"
          density="compact"
          placeholder="postgres, api"
          value={service.dependsOn.join(', ')}
          onChange={(e) => onChange({ ...service, dependsOn: parseDevEnvList(e.target.value) })}
        />
        <Input
          variant="code"
          density="compact"
          placeholder="/health"
          value={service.ready?.httpPath ?? ''}
          onChange={(e) =>
            onChange({
              ...service,
              ready: e.target.value ? { httpPath: e.target.value } : undefined
            })
          }
        />
        <Button
          variant="ghost"
          size="xs"
          aria-label={translate('devEnv.settings.removeService', 'Remove service')}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-[8rem_1fr_1fr] items-center gap-1.5">
        <span className="text-right text-2xs text-muted-foreground">
          {translate('devEnv.settings.prodVariant', 'prod build')}
        </span>
        <Input
          variant="code"
          density="compact"
          placeholder="pnpm build"
          aria-label={translate('devEnv.settings.prodBuild', 'Prod build command')}
          value={service.prod?.build ?? ''}
          onChange={(e) => setProd({ build: e.target.value, start: service.prod?.start ?? '' })}
        />
        <Input
          variant="code"
          density="compact"
          placeholder="pnpm start"
          aria-label={translate('devEnv.settings.prodStart', 'Prod start command')}
          value={service.prod?.start ?? ''}
          onChange={(e) => setProd({ build: service.prod?.build ?? '', start: e.target.value })}
        />
      </div>
    </div>
  )
}

function EnvFileEditor({
  file,
  onChange,
  onRemove
}: {
  file: DevEnvEnvFile
  onChange: (file: DevEnvEnvFile) => void
  onRemove: () => void
}): React.JSX.Element {
  const [text, setText] = useState(() => formatDevEnvEnvLines(file.lines))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(formatDevEnvEnvLines(file.lines)), [file.lines])
  return (
    <div className="space-y-1 rounded-md border border-border p-2">
      <div className="flex items-center gap-1.5">
        <Input
          variant="code"
          className="h-7"
          placeholder=".env"
          value={file.path}
          onChange={(e) => onChange({ ...file, path: e.target.value })}
        />
        <Input
          variant="code"
          className="h-7"
          placeholder=".env.example"
          value={file.base ?? ''}
          onChange={(e) => onChange({ ...file, base: e.target.value || undefined })}
        />
        <Input
          variant="code"
          className="h-7"
          placeholder="~/secrets/repo/.env"
          title={translate(
            'devEnv.settings.valuesFileHelp',
            'Personal values file outside the repos; read on every render and masked like secrets.'
          )}
          value={file.valuesFile ?? ''}
          onChange={(e) => onChange({ ...file, valuesFile: e.target.value || undefined })}
        />
        <Button
          variant="ghost"
          size="xs"
          aria-label={translate('devEnv.settings.removeFile', 'Remove file')}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <Textarea
        variant="code"
        className="min-h-24"
        spellCheck={false}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const parsed = parseDevEnvEnvLines(text)
          if ('error' in parsed) {
            setError(parsed.error)
            return
          }
          setError(null)
          onChange({ ...file, lines: parsed.lines })
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

/** Install commands, services and env files of one template slot. */
export function DevEnvSlotEditor({
  slot,
  onChange
}: {
  slot: DevEnvTemplateSlot
  onChange: (slot: DevEnvTemplateSlot) => void
}): React.JSX.Element {
  return (
    <div>
      <div className={SECTION}>
        {translate('devEnv.settings.install', 'Install (one command per line)')}
      </div>
      <Textarea
        variant="code"
        className="min-h-12"
        spellCheck={false}
        defaultValue={slot.install.join('\n')}
        key={`${slot.name}:install`}
        onBlur={(event) =>
          onChange({
            ...slot,
            install: event.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          })
        }
      />
      <div className={SECTION}>
        {translate(
          'devEnv.settings.services',
          'Services: name, command, offset, host, depends on, ready path'
        )}
      </div>
      <div className="space-y-1">
        {slot.services.map((service, index) => (
          <ServiceRow
            key={index}
            service={service}
            onChange={(next) =>
              onChange({
                ...slot,
                services: slot.services.map((entry, i) => (i === index ? next : entry))
              })
            }
            onRemove={() =>
              onChange({ ...slot, services: slot.services.filter((_, i) => i !== index) })
            }
          />
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            onChange({
              ...slot,
              services: [
                ...slot.services,
                {
                  name: `service-${slot.services.length + 1}`,
                  command: '',
                  portOffset: 0,
                  dependsOn: []
                }
              ]
            })
          }
        >
          <Plus />
          {translate('devEnv.settings.addService', 'Add service')}
        </Button>
      </div>
      <div className={SECTION}>
        {translate(
          'devEnv.settings.envFiles',
          'Env files: path, base file, personal values file, then KEY = value lines'
        )}
      </div>
      <div className="space-y-2">
        {slot.envFiles.map((file, index) => (
          <EnvFileEditor
            key={index}
            file={file}
            onChange={(next) =>
              onChange({
                ...slot,
                envFiles: slot.envFiles.map((entry, i) => (i === index ? next : entry))
              })
            }
            onRemove={() =>
              onChange({ ...slot, envFiles: slot.envFiles.filter((_, i) => i !== index) })
            }
          />
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            onChange({ ...slot, envFiles: [...slot.envFiles, { path: '.env', lines: [] }] })
          }
        >
          <Plus />
          {translate('devEnv.settings.addEnvFile', 'Add env file')}
        </Button>
      </div>
    </div>
  )
}
