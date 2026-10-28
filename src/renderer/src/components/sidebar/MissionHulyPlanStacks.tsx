import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { HulyMissionPlan } from '../../../../shared/huly/huly-mission-plan'
import type { HulyIssue } from '../../../../shared/huly/huly-types'
import { getOrderedStackTasks, moveStackTask } from './mission-huly-plan-order'

export const PLAN_SECTION_LABEL_CLASS =
  'text-2xs font-semibold uppercase tracking-wider text-muted-foreground'

/** Identifier, title and Huly status of one issue, on one line. */
export function HulyIssueLine({
  issue,
  children
}: {
  issue: HulyIssue
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-h-7 items-center gap-2 px-2 py-0.5 text-xs">
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">{issue.identifier}</span>
      <span className="min-w-0 flex-1 truncate" title={issue.title}>
        {issue.title}
      </span>
      <span className="shrink-0 text-2xs text-muted-foreground">{issue.status.name}</span>
      {children}
    </div>
  )
}

/** Each repo's stack bottom-up; tasks move within their repo only. */
export function MissionHulyPlanStacks({
  stacks,
  repoNameById,
  orderByRepo,
  onOrderChange
}: {
  stacks: HulyMissionPlan['stacks']
  repoNameById: ReadonlyMap<string, string>
  orderByRepo: Record<string, string[]>
  onOrderChange: (repoId: string, identifiers: string[]) => void
}): React.JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className={PLAN_SECTION_LABEL_CLASS}>
        {translate('auto.components.sidebar.MissionHulyPlanStacks.title', 'Task stacks')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.sidebar.MissionHulyPlanStacks.description',
          'The first task sits on the mission branch; each next one stacks on the task above it.'
        )}
      </p>
      {stacks.map((stack) => {
        const tasks = getOrderedStackTasks(stack.tasks, orderByRepo[stack.repoId])
        return (
          <div key={stack.repoId} className="space-y-1">
            <div className="text-xs font-medium">
              {repoNameById.get(stack.repoId) ?? stack.repoId}
            </div>
            <ol className="divide-y divide-border rounded-md border border-border">
              {tasks.map((task, index) => (
                <li key={task.issue.identifier}>
                  <HulyIssueLine issue={task.issue}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === 0}
                      aria-label={translate(
                        'auto.components.sidebar.MissionHulyPlanStacks.moveUp',
                        'Move {{identifier}} up',
                        { identifier: task.issue.identifier }
                      )}
                      onClick={() => onOrderChange(stack.repoId, moveStackTask(tasks, index, -1))}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === tasks.length - 1}
                      aria-label={translate(
                        'auto.components.sidebar.MissionHulyPlanStacks.moveDown',
                        'Move {{identifier}} down',
                        { identifier: task.issue.identifier }
                      )}
                      onClick={() => onOrderChange(stack.repoId, moveStackTask(tasks, index, 1))}
                    >
                      <ChevronDown />
                    </Button>
                  </HulyIssueLine>
                </li>
              ))}
            </ol>
          </div>
        )
      })}
    </section>
  )
}
