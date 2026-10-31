import { translate } from '@/i18n/i18n'
import React, { useMemo, useState } from 'react'
import { useActiveRepo, useActiveWorktreeId } from '@/store/selectors'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import { countTestResults } from './test-results-grouping'
import {
  getSelectionForFailed,
  getSelectionForFolder,
  getSelectionForTests
} from './test-run-selection'
import { TestResultDetail } from './TestResultDetail'
import { TestResultsList, getRunAge, getTriggerLabel } from './TestResultsList'
import { TestRunLaunchBar } from './TestRunLaunchBar'
import { TestRunLaunches } from './TestRunLaunches'
import { useTestRunLaunchControls, useTestRunLaunches } from './use-test-run-launches'
import { useTestRuns } from './use-test-runs'

function PanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 py-3 text-xs text-muted-foreground">{children}</p>
}

/** Latest Playwright results of the active workspace, and runs started from here. */
export default function TestRunsSidebarPanel(): React.JSX.Element {
  const worktreeId = useActiveWorktreeId()
  const repo = useActiveRepo()
  const isRemote = Boolean(repo?.connectionId) || (repo?.executionHostId ?? 'local') !== 'local'
  const scope = useMemo(
    () => (worktreeId && !isRemote ? { worktreeId } : null),
    [worktreeId, isRemote]
  )
  const { entries, runs } = useTestRuns(scope)
  const lastRun = runs?.[0]
  const controls = useTestRunLaunchControls(worktreeId, lastRun?.repo.root ?? null)
  const launches = useTestRunLaunches(worktreeId)
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
  const selected = entries.find((entry) => entry.result.identity === selectedIdentity)
  const failed = getSelectionForFailed(entries)
  const configFile = entries[0]?.result.configFile
  const counts = countTestResults(entries)
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto">
      <TestRunLaunchBar
        controls={controls}
        failedSelection={failed.kind === 'tests' && failed.locations.length > 0 ? failed : null}
        configFile={configFile}
      />
      <TestRunLaunches launches={launches} />
      {selected ? (
        <TestResultDetail
          entry={selected}
          traceWorktreeId={worktreeId}
          onBack={() => setSelectedIdentity(null)}
          onRun={() =>
            controls.launch(getSelectionForTests([selected]), selected.result.configFile)
          }
        />
      ) : entries.length === 0 ? (
        <PanelMessage>
          {translate(
            'testRuns.empty',
            'No test runs in this workspace yet. Runs started in Orca terminals appear here.'
          )}
        </PanelMessage>
      ) : (
        <>
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
                {lastRun.status === 'running'
                  ? ` · ${translate('testRuns.running', 'running…')}`
                  : ''}
              </span>
            ) : null}
          </div>
          <TestResultsList
            entries={entries}
            selectedIdentity={selectedIdentity}
            onSelect={(entry) => setSelectedIdentity(entry.result.identity)}
            onRunGroup={(folder, groupConfigFile) =>
              controls.launch(getSelectionForFolder(folder), groupConfigFile)
            }
          />
        </>
      )}
    </div>
  )
}
