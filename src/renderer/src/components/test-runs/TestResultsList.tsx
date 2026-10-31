import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import React, { useMemo } from 'react'
import { Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { TestRunTrigger } from '../../../../shared/test-runs/test-run-types'
import type { DevEnvTone } from '../dev-env/dev-env-labels'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import {
  getTestRowState,
  groupTestRows,
  type TestLabel,
  type TestResultState,
  type TestRowState
} from './test-results-grouping'
import { getRowConfigFile, getRowLabels, getRowTitlePath, type TestRow } from './test-rows'

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
    case 'serial':
      return translate('testRuns.label.serial', 'Serial')
    case 'tag':
    case 'project':
      return label.text
  }
}

export function TestLabels({ labels }: { labels: TestLabel[] }): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
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

const ROW_STATE_TONE: Record<TestRowState, DevEnvTone> = { ...TEST_STATE_TONE, neverRun: 'muted' }

export function TestResultsList({
  rows,
  knownBugAnnotations,
  tierPattern,
  selectedIdentity,
  onSelect,
  getWorkspaceName,
  onRunGroup,
  picked,
  onTogglePick,
  getNote
}: {
  rows: TestRow[]
  knownBugAnnotations: string[]
  tierPattern?: RegExp
  selectedIdentity: string | null
  onSelect: (row: TestRow) => void
  /** Global page: which workspace produced each result. */
  getWorkspaceName?: (row: TestRow) => string | null
  onRunGroup?: (folder: string, configFile: string) => void
  /** When set, rows show a checkbox to pick them for a run. */
  picked?: ReadonlySet<string>
  onTogglePick?: (identity: string) => void
  /** A line under the title, e.g. why Orca suggests the test. */
  getNote?: (row: TestRow) => string | null
}): React.JSX.Element {
  const groups = useMemo(() => groupTestRows(rows, { tierPattern }), [rows, tierPattern])
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
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
                    total: group.rows.length
                  })
                : group.rows.length}
            </span>
            {onRunGroup ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={translate('testRuns.launch.runFolder', 'Run this folder')}
                onClick={() => onRunGroup(group.label, getRowConfigFile(group.rows[0]))}
              >
                <Play className="size-3" />
              </Button>
            ) : null}
          </div>
          {group.rows.map((row) => {
            const workspace = getWorkspaceName?.(row)
            const state = getTestRowState(row)
            return (
              <div
                key={row.identity}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent',
                  selectedIdentity === row.identity && 'bg-accent'
                )}
              >
                {picked && onTogglePick ? (
                  <Checkbox
                    className="mt-0.5"
                    checked={picked.has(row.identity)}
                    onCheckedChange={() => onTogglePick(row.identity)}
                    aria-label={translate('testRuns.pick', 'Pick this test')}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                >
                  <span className="flex w-full items-center gap-2">
                    <DevEnvStatusDot
                      tone={ROW_STATE_TONE[state]}
                      className={cn(
                        state === 'neverRun' && 'bg-transparent ring-1 ring-muted-foreground/40'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {getRowTitlePath(row).join(' › ')}
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {row.latest
                        ? `${getRunAge(row.latest.run.startedAt)} · ${getTriggerLabel(row.latest.run.trigger)}`
                        : translate('testRuns.neverRun', 'never run')}
                      {workspace ? ` · ${workspace}` : ''}
                    </span>
                  </span>
                  {getNote?.(row) ? (
                    <span className="pl-4 text-2xs text-muted-foreground italic">
                      {getNote(row)}
                    </span>
                  ) : null}
                  <span className="pl-4">
                    <TestLabels labels={getRowLabels(row, { knownBugAnnotations })} />
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
