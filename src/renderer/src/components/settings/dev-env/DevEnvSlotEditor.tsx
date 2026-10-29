import React, { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/components/dev-env/dev-env-labels'
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
  const field = 'h-7 font-mono text-xs'
  return (
    <div className="grid grid-cols-[8rem_1fr_3.5rem_9rem_9rem_6rem_auto] items-center gap-1.5">
      <Input
        className={field}
        value={service.name}
        onChange={(e) => onChange({ ...service, name: e.target.value })}
      />
      <Input
        className={field}
        value={service.command}
        onChange={(e) => onChange({ ...service, command: e.target.value })}
      />
      <Input
        className={field}
        type="number"
        min={0}
        max={99}
        value={service.portOffset}
        onChange={(e) => onChange({ ...service, portOffset: Number(e.target.value) })}
      />
      <Input
        className={field}
        placeholder="admin.${devEnv.key}"
        value={service.host ?? ''}
        onChange={(e) => onChange({ ...service, host: e.target.value || undefined })}
      />
      <Input
        className={field}
        placeholder="postgres, api"
        value={service.dependsOn.join(', ')}
        onChange={(e) => onChange({ ...service, dependsOn: parseDevEnvList(e.target.value) })}
      />
      <Input
        className={field}
        placeholder="/health"
        value={service.ready?.httpPath ?? ''}
        onChange={(e) =>
          onChange({ ...service, ready: e.target.value ? { httpPath: e.target.value } : undefined })
        }
      />
      <Button
        variant="ghost"
        size="xs"
        aria-label={t('settings.removeService', 'Remove service')}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
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
          className="h-7 font-mono text-xs"
          placeholder=".env"
          value={file.path}
          onChange={(e) => onChange({ ...file, path: e.target.value })}
        />
        <Input
          className="h-7 font-mono text-xs"
          placeholder=".env.example"
          value={file.base ?? ''}
          onChange={(e) => onChange({ ...file, base: e.target.value || undefined })}
        />
        <Button
          variant="ghost"
          size="xs"
          aria-label={t('settings.removeFile', 'Remove file')}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <Textarea
        className="min-h-24 font-mono text-xs"
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
      <div className={SECTION}>{t('settings.install', 'Install (one command per line)')}</div>
      <Textarea
        className="min-h-12 font-mono text-xs"
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
        {t('settings.services', 'Services: name, command, offset, host, depends on, ready path')}
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
          {t('settings.addService', 'Add service')}
        </Button>
      </div>
      <div className={SECTION}>
        {t('settings.envFiles', 'Env files: path, base file, then KEY = value lines')}
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
          {t('settings.addEnvFile', 'Add env file')}
        </Button>
      </div>
    </div>
  )
}
