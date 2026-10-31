import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TestRunTrigger } from '../../../../shared/test-runs/test-run-types'
import type { DevEnvTone } from '../dev-env/dev-env-labels'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import {
  getTestLabels,
  getTestResultState,
  groupTestResults,
  type TestLabel,
  type TestResultEntry,
  type TestResultState
} from './test-results-grouping'

export const TEST_STATE_TONE: Record<TestResultState, DevEnvTone> = {
  passed: 'ok',
  failed: 'error',
  skipped: 'muted'
}

export function getTriggerLabel(trigger: TestRunTrigger): string {
  switch (trigger) {
    case 'agent':
      return translate('testRuns.trigger.agent', 'agent')
    case 'user':
      return translate('testRuns.trigger.user', 'you')
    case 'orca':
      return translate('testRuns.trigger.orca', 'Orca')
  }
}

export function getRunAge(startedAt: number): string {
  return formatUiRelativeTime(startedAt - Date.now())
}

function getLabelText(label: TestLabel): string {
  switch (label.kind) {
    case 'known-bug':
      return label.text
        ? translate('testRuns.label.knownBugWithId', 'Known bug {{id}}', { id: label.text })
        : translate('testRuns.label.knownBug', 'Known bug')
    case 'expected-fail':
      return translate('testRuns.label.expectedFail', 'Expected to fail')
    case 'tag':
    case 'project':
      return label.text
  }
}

export function TestLabels({ entry }: { entry: TestResultEntry }): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-1">
      {getTestLabels(entry.result).map((label) => (
        <Badge
          key={`${label.kind}:${label.text}`}
          variant="hostContext"
          className={cn(label.kind === 'known-bug' && 'text-status-warning')}
        >
          {getLabelText(label)}
        </Badge>
      ))}
    </span>
  )
}

export function TestResultsList({
  entries,
  selectedIdentity,
  onSelect,
  getWorkspaceName
}: {
  entries: TestResultEntry[]
  selectedIdentity: string | null
  onSelect: (entry: TestResultEntry) => void
  /** Global page: which workspace produced each result. */
  getWorkspaceName?: (entry: TestResultEntry) => string | null
}): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {groupTestResults(entries, {}).map((group) => (
        <div key={group.key} className="flex flex-col">
          <div className="flex items-center gap-2 px-2 pt-2 pb-1 text-2xs text-muted-foreground">
            <span className="flex-1 truncate font-mono">{group.label}</span>
            {group.tier !== null ? (
              <span>{translate('testRuns.tier', 'Tier {{tier}}', { tier: group.tier })}</span>
            ) : null}
            <span>
              {group.counts.failed > 0
                ? translate('testRuns.groupCountsFailed', '{{failed}} failed / {{total}}', {
                    failed: group.counts.failed,
                    total: group.entries.length
                  })
                : group.entries.length}
            </span>
          </div>
          {group.entries.map((entry) => {
            const workspace = getWorkspaceName?.(entry)
            return (
              <button
                key={entry.result.identity}
                type="button"
                onClick={() => onSelect(entry)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left text-xs hover:bg-accent',
                  selectedIdentity === entry.result.identity && 'bg-accent'
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <DevEnvStatusDot tone={TEST_STATE_TONE[getTestResultState(entry.result)]} />
                  <span className="min-w-0 flex-1 truncate">
                    {entry.result.titlePath.join(' › ')}
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {getRunAge(entry.run.startedAt)} · {getTriggerLabel(entry.run.trigger)}
                    {workspace ? ` · ${workspace}` : ''}
                  </span>
                </span>
                <span className="pl-4">
                  <TestLabels entry={entry} />
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
