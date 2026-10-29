import { translate } from '@/i18n/i18n'
import React, { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { runDevEnvAction } from '@/components/dev-env/dev-env-actions'

/** Names only; values go to main over IPC and are never read back here. */
export function DevEnvSecretsEditor(): React.JSX.Element {
  const [names, setNames] = useState<string[]>([])
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const load = useCallback(() => {
    void runDevEnvAction(
      translate('devEnv.secrets.loadFailed', 'Could not list secrets'),
      async () => setNames(await window.api.devEnv.secretsList())
    )
  }, [])
  useEffect(load, [load])
  const save = (): void => {
    void runDevEnvAction(
      translate('devEnv.secrets.saveFailed', 'Could not save the secret'),
      async () => {
        await window.api.devEnv.secretSet({ name: name.trim(), value })
        setName('')
        setValue('')
        load()
      }
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'devEnv.secrets.help',
          'Use them in env lines as ${secret.<name>}. Names: lowercase letters, digits and dashes.'
        )}
      </p>
      {names.map((secret) => (
        <div key={secret} className="flex items-center gap-2 text-[13px]">
          <span className="flex-1 font-mono text-xs">{secret}</span>
          <span className="font-mono text-xs text-muted-foreground">••••••</span>
          <Button variant="ghost" size="xs" onClick={() => setName(secret)}>
            {translate('devEnv.secrets.replace', 'Replace')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-label={translate('devEnv.secrets.delete', 'Delete')}
            onClick={() =>
              void runDevEnvAction(
                translate('devEnv.secrets.deleteFailed', 'Could not delete the secret'),
                async () => {
                  await window.api.devEnv.secretDelete({ name: secret })
                  load()
                }
              )
            }
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          variant="code"
          className="h-8 w-48"
          placeholder="maps-key"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          variant="code"
          className="h-8 flex-1"
          type="password"
          placeholder={translate('devEnv.secrets.value', 'Value')}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button size="sm" variant="outline" disabled={!name.trim() || !value} onClick={save}>
          {translate('devEnv.secrets.save', 'Save secret')}
        </Button>
      </div>
    </div>
  )
}
