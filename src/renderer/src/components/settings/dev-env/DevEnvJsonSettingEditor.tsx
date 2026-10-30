import { translate } from '@/i18n/i18n'
import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store'
import {
  normalizeDevEnvSettings,
  type DevEnvGlobalSettings
} from '../../../../../shared/dev-env/dev-env-settings'

type JsonListField = 'devEnvInfra' | 'devEnvRemoteTiers' | 'devEnvTools'

function getListUpdate(
  normalized: DevEnvGlobalSettings,
  field: JsonListField
): { update: Partial<DevEnvGlobalSettings>; saved: number } {
  switch (field) {
    case 'devEnvInfra':
      return {
        update: { devEnvInfra: normalized.devEnvInfra },
        saved: normalized.devEnvInfra.length
      }
    case 'devEnvRemoteTiers':
      return {
        update: { devEnvRemoteTiers: normalized.devEnvRemoteTiers },
        saved: normalized.devEnvRemoteTiers.length
      }
    case 'devEnvTools':
      return {
        update: { devEnvTools: normalized.devEnvTools },
        saved: normalized.devEnvTools.length
      }
  }
}

const NO_ENTRIES: readonly unknown[] = []

function formatEntries(entries: readonly unknown[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`
}

/** A settings list edited as JSON; the shared normalizer is the validator, so dropped entries are reported. */
export function DevEnvJsonSettingEditor({
  field,
  help,
  saveLabel,
  importLabel
}: {
  field: JsonListField
  help: string
  saveLabel: string
  importLabel: string
}): React.JSX.Element {
  const entries = useAppStore((s) => s.settings?.[field]) ?? NO_ENTRIES
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [text, setText] = useState(() => formatEntries(entries))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setText(formatEntries(entries)), [entries])

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
      setError(translate('devEnv.json.notArray', 'Expected a JSON array'))
      return
    }
    const normalized = normalizeDevEnvSettings({ [field]: parsed }, 'darwin')
    const { update, saved } = getListUpdate(normalized, field)
    setError(null)
    void updateSettings(update)
    if (saved !== parsed.length) {
      toast.warning(
        translate('devEnv.json.dropped', '{count} invalid entries were not saved').replace(
          '{count}',
          String(parsed.length - saved)
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
      <p className="text-xs text-muted-foreground">{help}</p>
      <Textarea
        variant="code"
        className="min-h-64"
        spellCheck={false}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>
          {saveLabel}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <label className="cursor-pointer">
            {importLabel}
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
