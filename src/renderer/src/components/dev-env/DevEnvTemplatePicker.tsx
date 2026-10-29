import React from 'react'
import { useAppStore } from '@/store'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { isWebClient } from '../sidebar/worktree-card-model'
import type { DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'
import { t } from './dev-env-labels'
import { getDevEnvTemplateNotes } from './dev-env-template-notes'

const NONE = '__none__'
const NO_TEMPLATES: readonly DevEnvTemplate[] = []

export function useDevEnvTemplates(): readonly DevEnvTemplate[] {
  return useAppStore((s) => s.settings?.devEnvTemplates) ?? NO_TEMPLATES
}

/** Optional template for a new mission or worktree; renders nothing until a template exists. */
export function DevEnvTemplatePicker({
  value,
  onChange,
  repoIds
}: {
  value: string | null
  onChange: (templateId: string | null) => void
  /** Mission members; omit for a single worktree. */
  repoIds?: readonly string[]
}): React.JSX.Element | null {
  const templates = useDevEnvTemplates()
  if (templates.length === 0 || isWebClient()) {
    return null
  }
  const selected = templates.find((template) => template.id === value)
  const notes = selected && repoIds ? getDevEnvTemplateNotes(selected, repoIds) : []
  return (
    <div className="space-y-1">
      <Label variant="settings">{t('picker.label', 'Dev Environment')}</Label>
      <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('picker.none', 'None')}</SelectItem>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'picker.help',
            'After create: env, dependencies, infra and data. Start services yourself.'
          )}
        </p>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  )
}
