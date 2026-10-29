import React, { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { t } from '@/components/dev-env/dev-env-labels'
import type { DevEnvCredential, DevEnvTemplate } from '../../../../../shared/dev-env/dev-env-types'
import {
  addDevEnvSlot,
  parseDevEnvList,
  removeDevEnvSlot,
  updateDevEnvSlot
} from './dev-env-template-edit'
import { DevEnvSlotEditor } from './DevEnvSlotEditor'

const NO_REPO = '__none__'
const SECTION = 'mb-1 mt-4 text-2xs font-semibold tracking-wider text-muted-foreground uppercase'

function CredentialRows({
  credentials,
  onChange
}: {
  credentials: DevEnvCredential[]
  onChange: (credentials: DevEnvCredential[]) => void
}): React.JSX.Element {
  const update = (index: number, changes: Partial<DevEnvCredential>): void =>
    onChange(credentials.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)))
  return (
    <div className="space-y-1">
      {credentials.map((credential, index) => (
        <div key={index} className="flex gap-1.5">
          <Input
            className="h-7 text-xs"
            placeholder={t('settings.credLabel', 'Label')}
            value={credential.label}
            onChange={(e) => update(index, { label: e.target.value })}
          />
          <Input
            className="h-7 font-mono text-xs"
            placeholder="secret.operator-user"
            value={credential.userKey}
            onChange={(e) => update(index, { userKey: e.target.value })}
          />
          <Input
            className="h-7 font-mono text-xs"
            placeholder="secret.operator-pass"
            value={credential.passwordKey}
            onChange={(e) => update(index, { passwordKey: e.target.value })}
          />
          <Button
            variant="ghost"
            size="xs"
            aria-label={t('settings.remove', 'Remove')}
            onClick={() => onChange(credentials.filter((_, i) => i !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onChange([...credentials, { label: '', userKey: '', passwordKey: '' }])}
      >
        <Plus />
        {t('settings.addCredential', 'Add login')}
      </Button>
    </div>
  )
}

/** Draft editing of one template; nothing is stored until Save. */
export function DevEnvTemplateEditor({
  template,
  onSave
}: {
  template: DevEnvTemplate
  onSave: (template: DevEnvTemplate) => void
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const [draft, setDraft] = useState(template)
  const [activeSlot, setActiveSlot] = useState<string | null>(template.slots[0]?.name ?? null)
  const [newSlot, setNewSlot] = useState('')
  useEffect(() => {
    setDraft(template)
    setActiveSlot(template.slots[0]?.name ?? null)
  }, [template])
  const slot = draft.slots.find((entry) => entry.name === activeSlot)
  const dirty = draft !== template

  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 max-w-xs text-sm font-semibold"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <span className="flex-1" />
        <Button size="sm" disabled={!dirty} onClick={() => onSave(draft)}>
          {t('settings.saveTemplate', 'Save template')}
        </Button>
      </div>
      <div className={SECTION}>{t('settings.slots', 'Slots')}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {draft.slots.map((entry) => (
          <button
            key={entry.name}
            type="button"
            onClick={() => setActiveSlot(entry.name)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs',
              entry.name === activeSlot
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            )}
          >
            {entry.name}
          </button>
        ))}
        <Input
          className="h-6 w-28 text-xs"
          placeholder={t('settings.slotName', 'slot name')}
          value={newSlot}
          onChange={(e) => setNewSlot(e.target.value)}
        />
        <Button
          variant="ghost"
          size="xs"
          disabled={!newSlot.trim()}
          onClick={() => {
            const next = addDevEnvSlot(draft, newSlot.trim())
            setDraft(next)
            setActiveSlot(next.slots.at(-1)?.name ?? null)
            setNewSlot('')
          }}
        >
          <Plus />
          {t('settings.addSlot', 'Add slot')}
        </Button>
      </div>
      {slot ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <div className="flex items-center gap-2">
            <Label variant="settings" className="w-12">
              {t('settings.repo', 'Repo')}
            </Label>
            <Select
              value={slot.repoId ?? NO_REPO}
              onValueChange={(value) =>
                setDraft(
                  updateDevEnvSlot(draft, slot.name, { repoId: value === NO_REPO ? null : value })
                )
              }
            >
              <SelectTrigger size="sm" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REPO}>{t('settings.noRepo', 'No repo')}</SelectItem>
                {repos.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                const next = removeDevEnvSlot(draft, slot.name)
                setDraft(next)
                setActiveSlot(next.slots[0]?.name ?? null)
              }}
            >
              {t('settings.removeSlot', 'Remove slot')}
            </Button>
          </div>
          <DevEnvSlotEditor
            slot={slot}
            onChange={(next) => setDraft(updateDevEnvSlot(draft, slot.name, next))}
          />
        </div>
      ) : null}
      <div className={SECTION}>
        {t('settings.dependencies', 'Dependencies from other environments')}
      </div>
      <Input
        className="h-7 font-mono text-xs"
        placeholder="admin-api, geo"
        defaultValue={draft.dependencies.join(', ')}
        key={`${draft.id}:deps`}
        onBlur={(e) => setDraft({ ...draft, dependencies: parseDevEnvList(e.target.value) })}
      />
      <div className={SECTION}>{t('settings.seed', 'Seed')}</div>
      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 w-32 font-mono text-xs"
          placeholder={t('settings.seedSlot', 'slot')}
          value={draft.seed?.slot ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              seed: {
                slot: e.target.value,
                command: draft.seed?.command ?? '',
                enabledByDefault: draft.seed?.enabledByDefault ?? false
              }
            })
          }
        />
        <Input
          className="h-7 flex-1 font-mono text-xs"
          placeholder="npm run seed"
          value={draft.seed?.command ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              seed: {
                slot: draft.seed?.slot ?? '',
                command: e.target.value,
                enabledByDefault: draft.seed?.enabledByDefault ?? false
              }
            })
          }
        />
        <Label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={draft.seed?.enabledByDefault === true}
            onCheckedChange={(value) =>
              setDraft({
                ...draft,
                seed: {
                  slot: draft.seed?.slot ?? '',
                  command: draft.seed?.command ?? '',
                  enabledByDefault: value === true
                }
              })
            }
          />
          {t('settings.seedOnCreate', 'Run on create')}
        </Label>
      </div>
      <div className={SECTION}>{t('settings.credentials', 'Logins to show (context keys)')}</div>
      <CredentialRows
        credentials={draft.credentials}
        onChange={(credentials) => setDraft({ ...draft, credentials })}
      />
    </div>
  )
}
