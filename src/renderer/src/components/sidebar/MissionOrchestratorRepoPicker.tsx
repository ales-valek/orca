import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { Repo } from '../../../../shared/repo-types'

// Why: Radix Select reserves the empty string for "no value", so "None" needs its own token.
const NO_ORCHESTRATOR = '__no-orchestrator__'

/** Optional repo the Mission orchestrator runs from; member repos are not offered. */
export function MissionOrchestratorRepoPicker({
  eligibleRepos,
  memberRepoIds,
  value,
  onChange,
  id
}: {
  /** Repos that already passed the Mission eligibility gate. */
  eligibleRepos: readonly Repo[]
  memberRepoIds: ReadonlySet<string>
  value: string | null
  onChange: (repoId: string | null) => void
  id?: string
}): React.JSX.Element {
  const options = eligibleRepos.filter((repo) => !memberRepoIds.has(repo.id))
  const selected = value && options.some((repo) => repo.id === value) ? value : NO_ORCHESTRATOR
  return (
    <Select
      value={selected}
      onValueChange={(next) => onChange(next === NO_ORCHESTRATOR ? null : next)}
    >
      <SelectTrigger id={id} size="sm" density="compact" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ORCHESTRATOR}>
          {translate('auto.components.sidebar.MissionOrchestratorRepoPicker.8501d7774b', 'None')}
        </SelectItem>
        {options.map((repo) => (
          <SelectItem key={repo.id} value={repo.id}>
            {repo.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The picked orchestrator unless it has since become a member repo. */
export function getEffectiveOrchestratorRepoId(
  value: string | null,
  memberRepoIds: ReadonlySet<string>
): string | null {
  return value && !memberRepoIds.has(value) ? value : null
}
