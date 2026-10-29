import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store'
import { t } from '@/components/dev-env/dev-env-labels'
import { normalizeDevEnvSettings } from '../../../../../shared/dev-env/dev-env-settings'
import type { DevEnvInfraService } from '../../../../../shared/dev-env/dev-env-types'

const NO_INFRA: readonly DevEnvInfraService[] = []

function formatInfra(services: readonly DevEnvInfraService[]): string {
  return `${JSON.stringify(services, null, 2)}\n`
}

/** Compose-like services as JSON; the shared normalizer is the validator, so dropped entries are reported. */
export function DevEnvInfraEditor(): React.JSX.Element {
  const infra = useAppStore((s) => s.settings?.devEnvInfra) ?? NO_INFRA
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [text, setText] = useState(() => formatInfra(infra))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(formatInfra(infra)), [infra])

  const save = (): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (parseError) {
      setError(
        `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      )
      return
    }
    if (!Array.isArray(parsed)) {
      setError(t('infra.notArray', 'Expected a JSON array of services'))
      return
    }
    const services = normalizeDevEnvSettings({ devEnvInfra: parsed }, 'darwin').devEnvInfra
    setError(null)
    void updateSettings({ devEnvInfra: services })
    if (services.length !== parsed.length) {
      toast.warning(
        t('infra.dropped', '{count} invalid service(s) were not saved').replace(
          '{count}',
          String(parsed.length - services.length)
        )
      )
    }
  }

  const importFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      void file.text().then(setText)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t(
          'infra.help',
          'Each service: name, image or build, ports [{name, host, container}], environment, volumes, healthcheck, resource {create, drop}. Resource commands run inside the container for each environment and must be safe to run twice.'
        )}
      </p>
      <Textarea
        className="min-h-64 font-mono text-xs"
        spellCheck={false}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>
          {t('infra.save', 'Save infra')}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <label className="cursor-pointer">
            {t('infra.import', 'Import infra JSON')}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importFile}
            />
          </label>
        </Button>
      </div>
    </div>
  )
}
