import { translate } from '@/i18n/i18n'
import React, { useMemo, useState } from 'react'
import { useActiveRepo, useActiveWorktreeId } from '@/store/selectors'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import { countTestResults } from './test-results-grouping'
import { TestResultDetail } from './TestResultDetail'
import { TestResultsList, getRunAge, getTriggerLabel } from './TestResultsList'
import { useTestRuns } from './use-test-runs'

function PanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 py-3 text-xs text-muted-foreground">{children}</p>
}

/** Latest Playwright results of the active workspace, as captured from its terminals. */
export default function TestRunsSidebarPanel(): React.JSX.Element {
  const worktreeId = useActiveWorktreeId()
  const repo = useActiveRepo()
  const isRemote = Boolean(repo?.connectionId) || (repo?.executionHostId ?? 'local') !== 'local'
  const scope = useMemo(
    () => (worktreeId && !isRemote ? { worktreeId } : null),
    [worktreeId, isRemote]
  )
  const { entries, runs } = useTestRuns(scope)
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null)

  if (isRemote) {
    return (
      <PanelMessage>
        {translate('testRuns.remote', 'Tests are not available for remote workspaces yet.')}
      </PanelMessage>
    )
  }
  if (!worktreeId || entries === null) {
    return <PanelMessage>{translate('testRuns.loading', 'Loading test runs…')}</PanelMessage>
  }
  if (entries.length === 0) {
    return (
      <PanelMessage>
        {translate(
          'testRuns.empty',
          'No test runs in this workspace yet. Runs started in Orca terminals appear here.'
        )}
      </PanelMessage>
    )
  }
  const selected = entries.find((entry) => entry.result.identity === selectedIdentity)
  if (selected) {
    return (
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <TestResultDetail
          entry={selected}
          traceWorktreeId={worktreeId}
          onBack={() => setSelectedIdentity(null)}
        />
      </div>
    )
  }
  const counts = countTestResults(entries)
  const lastRun = runs?.[0]
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-xs">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <DevEnvStatusDot tone="ok" />
            {counts.passed}
          </span>
          <span className="flex items-center gap-1">
            <DevEnvStatusDot tone="error" />
            {counts.failed}
          </span>
          <span className="flex items-center gap-1">
            <DevEnvStatusDot tone="muted" />
            {counts.skipped}
          </span>
        </span>
        {lastRun ? (
          <span className="text-2xs text-muted-foreground">
            {translate('testRuns.lastRun', 'Last run {{age}} by {{who}}', {
              age: getRunAge(lastRun.startedAt),
              who: getTriggerLabel(lastRun.trigger)
            })}
            {lastRun.status === 'running' ? ` · ${translate('testRuns.running', 'running…')}` : ''}
          </span>
        ) : null}
      </div>
      <TestResultsList
        entries={entries}
        selectedIdentity={selectedIdentity}
        onSelect={(entry) => setSelectedIdentity(entry.result.identity)}
      />
    </div>
  )
}
