import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { Repo } from '../../../../shared/repo-types'
import { MissionHulyPlanView, type MissionHulyPlanPicks } from './MissionHulyPlanView'
import type { HulyMilestonePlanState } from './use-huly-milestone-plan'

function PlanError(props: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
        {props.message}
      </p>
      <Button type="button" variant="ghost" size="sm" onClick={props.onRetry}>
        {translate('auto.components.sidebar.MissionHulyPlanBody.retry', 'Retry')}
      </Button>
    </div>
  )
}

/** The plan area of the create dialog for every load state. */
export function MissionHulyPlanBody({
  planState,
  hideErrors,
  repos,
  repoNameById,
  picks,
  onPicksChange
}: {
  planState: HulyMilestonePlanState
  /** Set while a reconnect notice already explains the failure. */
  hideErrors: boolean
  repos: readonly Repo[]
  repoNameById: ReadonlyMap<string, string>
  picks: MissionHulyPlanPicks
  onPicksChange: (picks: MissionHulyPlanPicks) => void
}): React.JSX.Element | null {
  if (planState.state === 'idle') {
    return null
  }
  if (planState.state === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {translate('auto.components.sidebar.MissionHulyPlanBody.loading', 'Loading the plan...')}
      </div>
    )
  }
  if (planState.state === 'error') {
    if (hideErrors) {
      return null
    }
    return <PlanError message={planState.message} onRetry={planState.retry} />
  }
  const { plan } = planState
  const isEmpty =
    plan.stacks.length === 0 && plan.cycles.length === 0 && planState.unmapped.length === 0
  return (
    <div className="space-y-3">
      {planState.planError && !hideErrors ? (
        <PlanError message={planState.planError} onRetry={planState.retry} />
      ) : null}
      {isEmpty ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.sidebar.MissionHulyPlanBody.empty',
            'This milestone has no open issues to turn into tasks.'
          )}
        </p>
      ) : null}
      <MissionHulyPlanView
        plan={plan}
        unmapped={planState.unmapped}
        repos={repos}
        repoNameById={repoNameById}
        picks={picks}
        onPicksChange={onPicksChange}
        onReload={planState.retry}
      />
    </div>
  )
}
