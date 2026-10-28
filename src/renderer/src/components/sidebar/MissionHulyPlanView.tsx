import React, { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { HulyMissionPlan } from '../../../../shared/huly/huly-mission-plan'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  HulyIssueLine,
  MissionHulyPlanStacks,
  PLAN_SECTION_LABEL_CLASS
} from './MissionHulyPlanStacks'

export type MissionHulyPlanPicks = {
  /** Issue identifier -> repo id picked for an unmapped issue. */
  repoOverrides: Record<string, string>
  /** Identifiers whose pick is saved for their component. */
  remembered: ReadonlySet<string>
  /** Repo id -> identifiers in the user's stack order. */
  orderByRepo: Record<string, string[]>
}

function UnmappedIssueRow({
  issue,
  repos,
  repoId,
  remembered,
  onRepoChange,
  onRememberChange
}: {
  issue: HulyIssue
  repos: readonly Repo[]
  repoId: string | undefined
  remembered: boolean
  onRepoChange: (repoId: string) => void
  onRememberChange: (remember: boolean) => void
}): React.JSX.Element {
  const rememberId = useId()
  return (
    <li className="space-y-1 py-1">
      <HulyIssueLine issue={issue} />
      <div className="flex flex-wrap items-center gap-3 px-2">
        <Select
          value={repoId ?? ''}
          onValueChange={(next) => {
            // Radix reports '' for the hidden form select; '' is never a real pick.
            if (next) {
              onRepoChange(next)
            }
          }}
        >
          <SelectTrigger
            size="sm"
            density="compact"
            className="w-48"
            aria-label={translate(
              'auto.components.sidebar.MissionHulyPlanView.repoFor',
              'Repository for {{identifier}}',
              { identifier: issue.identifier }
            )}
          >
            <SelectValue
              placeholder={translate(
                'auto.components.sidebar.MissionHulyPlanView.chooseRepo',
                'Choose a repository'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {repos.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {issue.componentId !== null ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={rememberId}
              checked={remembered}
              disabled={!repoId}
              onCheckedChange={(checked) => onRememberChange(checked === true)}
            />
            <Label htmlFor={rememberId} variant="settings">
              {translate(
                'auto.components.sidebar.MissionHulyPlanView.remember',
                'Remember for this component'
              )}
            </Label>
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** The milestone plan: stacks to reorder, issues that need a repository, cycles and skipped issues. */
export function MissionHulyPlanView({
  plan,
  unmapped,
  repos,
  repoNameById,
  picks,
  onPicksChange,
  onReload
}: {
  plan: HulyMissionPlan
  unmapped: readonly HulyIssue[]
  /** Repos an unmapped issue may go to. */
  repos: readonly Repo[]
  repoNameById: ReadonlyMap<string, string>
  picks: MissionHulyPlanPicks
  onPicksChange: (picks: MissionHulyPlanPicks) => void
  onReload: () => void
}): React.JSX.Element {
  const [skippedOpen, setSkippedOpen] = useState(false)
  const setRemembered = (identifier: string, remember: boolean): void => {
    const remembered = new Set(picks.remembered)
    if (remember) {
      remembered.add(identifier)
    } else {
      remembered.delete(identifier)
    }
    onPicksChange({ ...picks, remembered })
  }

  return (
    <div className="space-y-4">
      {plan.cycles.length > 0 ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {plan.cycles.map((cycle) => (
              <p key={cycle.repoId} role="alert" className="text-xs text-destructive">
                {translate(
                  'auto.components.sidebar.MissionHulyPlanView.cycle',
                  'These issues in {{repo}} block each other in a cycle: {{identifiers}}. Break the cycle in Huly, then reload the plan.',
                  {
                    repo: repoNameById.get(cycle.repoId) ?? cycle.repoId,
                    identifiers: cycle.identifiers.join(', ')
                  }
                )}
              </p>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onReload}>
            {translate('auto.components.sidebar.MissionHulyPlanView.reload', 'Reload plan')}
          </Button>
        </div>
      ) : null}
      {plan.stacks.length > 0 ? (
        <MissionHulyPlanStacks
          stacks={plan.stacks}
          repoNameById={repoNameById}
          orderByRepo={picks.orderByRepo}
          onOrderChange={(repoId, identifiers) =>
            onPicksChange({
              ...picks,
              orderByRepo: { ...picks.orderByRepo, [repoId]: identifiers }
            })
          }
        />
      ) : null}
      {unmapped.length > 0 ? (
        <section className="space-y-2">
          <h3 className={PLAN_SECTION_LABEL_CLASS}>
            {translate(
              'auto.components.sidebar.MissionHulyPlanView.unmappedTitle',
              'Issues without a repository'
            )}
          </h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {unmapped.map((issue) => (
              <UnmappedIssueRow
                key={issue.identifier}
                issue={issue}
                repos={repos}
                repoId={picks.repoOverrides[issue.identifier]}
                remembered={picks.remembered.has(issue.identifier)}
                onRepoChange={(repoId) =>
                  onPicksChange({
                    ...picks,
                    repoOverrides: { ...picks.repoOverrides, [issue.identifier]: repoId }
                  })
                }
                onRememberChange={(remember) => setRemembered(issue.identifier, remember)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {plan.skipped.length > 0 ? (
        <Collapsible open={skippedOpen} onOpenChange={setSkippedOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="-ml-2">
              {skippedOpen ? <ChevronDown /> : <ChevronRight />}
              {translate(
                'auto.components.sidebar.MissionHulyPlanView.skipped',
                'Skipped issues ({{count}})',
                { count: plan.skipped.length }
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1 divide-y divide-border rounded-md border border-border">
              {plan.skipped.map((issue) => (
                <li key={issue.identifier}>
                  <HulyIssueLine issue={issue} />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
