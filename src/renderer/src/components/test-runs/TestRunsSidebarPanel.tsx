import { translate } from '@/i18n/i18n'
import React, { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useActiveRepo, useActiveWorktreeId } from '@/store/selectors'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import { getTestRowState } from './test-results-grouping'
import {
  buildTestRows,
  getRowConfigFile,
  getRowFile,
  getRowLabels,
  getRowTitlePath,
  type TestRow
} from './test-rows'
import {
  getSelectionForFailed,
  getSelectionForFolder,
  getSelectionForRows,
  getSelectionForTests
} from './test-run-selection'
import { getTestTier } from '../../../../shared/test-runs/test-identity'
import { TestResultDetail } from './TestResultDetail'
import { TestLabels, TestResultsList, getRunAge, getTriggerLabel } from './TestResultsList'
import { TestRunLaunchBar } from './TestRunLaunchBar'
import { TestRunLaunches } from './TestRunLaunches'
import { filterTestRows, isFeatureRow, type TestRowFilter } from './test-row-filters'
import { TestRowSearchField } from './TestRowSearchField'
import { useFeatureScope, useTestCatalog } from './use-test-catalog'
import {
  useSourceRepoSettings,
  useTestRunLaunchControls,
  useTestRunLaunches
} from './use-test-run-launches'
import { useTestRuns } from './use-test-runs'

function PanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 py-3 text-xs text-muted-foreground">{children}</p>
}

function FilterChip({
  isActive,
  onClick,
  children
}: {
  isActive: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      size="xs"
      variant={isActive ? 'secondary' : 'ghost'}
      aria-pressed={isActive}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** A test Playwright lists but no run has recorded yet. */
function NeverRunDetail({
  row,
  labels,
  onBack,
  onRun
}: {
  row: TestRow
  labels: ReturnType<typeof getRowLabels>
  onBack: () => void
  onRun: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-3 py-2 text-xs">
      <span className="font-medium">{getRowTitlePath(row).join(' › ')}</span>
      <span className="font-mono text-2xs text-muted-foreground">
        {row.catalog?.file}:{row.catalog?.line}
      </span>
      <TestLabels labels={labels} />
      <span className="text-muted-foreground">
        {translate('testRuns.neverRunHint', 'This test has not run yet.')}
      </span>
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={onBack}>
          {translate('testRuns.back', 'Back')}
        </Button>
        <Button size="xs" onClick={onRun}>
          {translate('testRuns.launch.runAgain', 'Run')}
        </Button>
      </div>
    </div>
  )
}

/** Every test of the chosen source with its latest result, and runs started from here. */
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
  const source = controls.sources?.find((option) => option.id === controls.choices.sourceId)
  const configFile = entries?.[0]?.result.configFile ?? source?.configFiles[0] ?? null
  const { catalog, isLoading } = useTestCatalog({
    targetId: isRemote ? null : controls.choices.targetId,
    sourceId: isRemote ? null : controls.choices.sourceId,
    configFile
  })
  const repoSettings = useSourceRepoSettings(controls)
  const rows = useMemo(
    () => buildTestRows(catalog?.entries ?? [], entries ?? []),
    [catalog, entries]
  )
  const featureScope = useFeatureScope(isRemote ? null : controls.choices.sourceId)
  const featureRows = useMemo(
    () =>
      featureScope && worktreeId
        ? rows.filter((row) => isFeatureRow(row, featureScope, worktreeId))
        : [],
    [rows, featureScope, worktreeId]
  )
  const [chosenFilter, setChosenFilter] = useState<TestRowFilter | null>(null)
  const filter = chosenFilter ?? (featureRows.length > 0 ? 'feature' : 'all')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null)
  const tiers = useMemo(
    () =>
      [...new Set(rows.map((row) => getTestTier(getRowFile(row), repoSettings.tierPattern)))]
        .filter((tier): tier is number => tier !== null)
        .toSorted((a, b) => a - b),
    [rows, repoSettings.tierPattern]
  )
  const visibleRows = useMemo(
    () =>
      filterTestRows(rows, {
        query,
        filter,
        feature: featureScope ?? { changedSpecFiles: [], since: null },
        worktreeId: worktreeId ?? '',
        tierPattern: repoSettings.tierPattern
      }),
    [rows, query, filter, featureScope, worktreeId, repoSettings.tierPattern]
  )
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
  const selected = rows.find((row) => row.identity === selectedIdentity)
  const failed = getSelectionForFailed(entries)
  const counts = { passed: 0, failed: 0, skipped: 0, neverRun: 0 }
  for (const row of rows) {
    counts[getTestRowState(row)]++
  }
  const runRow = (row: TestRow): void =>
    controls.launch(
      row.catalog
        ? { kind: 'tests', locations: [`${row.catalog.file}:${row.catalog.line}`] }
        : getSelectionForTests(row.latest ? [row.latest] : []),
      getRowConfigFile(row)
    )
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto">
      <TestRunLaunchBar
        controls={controls}
        failedSelection={failed.kind === 'tests' && failed.locations.length > 0 ? failed : null}
        configFile={configFile ?? undefined}
      />
      <TestRunLaunches launches={launches} />
      {selected?.latest ? (
        <TestResultDetail
          entry={selected.latest}
          labels={getRowLabels(selected, repoSettings)}
          traceWorktreeId={worktreeId}
          onBack={() => setSelectedIdentity(null)}
          onRun={() => runRow(selected)}
        />
      ) : selected ? (
        <NeverRunDetail
          row={selected}
          labels={getRowLabels(selected, repoSettings)}
          onBack={() => setSelectedIdentity(null)}
          onRun={() => runRow(selected)}
        />
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
              <span className="text-muted-foreground">
                {translate('testRuns.neverRunCount', '{{count}} never run', {
                  count: counts.neverRun
                })}
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
            {isLoading ? (
              <span className="text-2xs text-muted-foreground">
                {translate('testRuns.listing', 'Listing tests…')}
              </span>
            ) : null}
            {catalog?.error ? (
              <details className="text-2xs text-destructive">
                <summary className="cursor-pointer">
                  {translate('testRuns.listFailed', 'Could not list the tests')}
                </summary>
                <pre className="scrollbar-sleek mt-1 max-h-40 overflow-auto font-mono whitespace-pre-wrap">
                  {catalog.error}
                </pre>
              </details>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 border-b border-border px-3 py-1.5">
            <TestRowSearchField query={query} onQueryChange={setQuery} />
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip
                isActive={filter === 'feature'}
                onClick={() => setChosenFilter('feature')}
              >
                {translate('testRuns.filter.feature', 'My feature ({{count}})', {
                  count: featureRows.length
                })}
              </FilterChip>
              <FilterChip isActive={filter === 'failed'} onClick={() => setChosenFilter('failed')}>
                {translate('testRuns.filter.failed', 'Failed ({{count}})', {
                  count: counts.failed
                })}
              </FilterChip>
              <FilterChip
                isActive={filter === 'never-run'}
                onClick={() => setChosenFilter('never-run')}
              >
                {translate('testRuns.filter.neverRun', 'Never run ({{count}})', {
                  count: counts.neverRun
                })}
              </FilterChip>
              {tiers.map((tier) => (
                <FilterChip
                  key={tier}
                  isActive={typeof filter === 'object' && filter.tier === tier}
                  onClick={() => setChosenFilter({ tier })}
                >
                  {translate('testRuns.tier', 'Tier {{tier}}', { tier })}
                </FilterChip>
              ))}
              <FilterChip isActive={filter === 'all'} onClick={() => setChosenFilter('all')}>
                {translate('testRuns.filter.all', 'All ({{count}})', { count: rows.length })}
              </FilterChip>
              <span className="flex-1" />
              {picked ? (
                <>
                  <Button
                    size="xs"
                    disabled={picked.size === 0}
                    onClick={() => {
                      controls.launch(
                        getSelectionForRows(rows.filter((row) => picked.has(row.identity))),
                        configFile ?? undefined
                      )
                      setPicked(null)
                    }}
                  >
                    {translate('testRuns.runPicked', 'Run selected ({{count}})', {
                      count: picked.size
                    })}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setPicked(null)}>
                    {translate('testRuns.cancelPick', 'Cancel')}
                  </Button>
                </>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setPicked(new Set())}>
                  {translate('testRuns.pickTests', 'Select')}
                </Button>
              )}
            </div>
          </div>
          {filter === 'feature' && featureScope && featureScope.changedOtherFiles.length > 0 ? (
            <p className="px-3 pt-1.5 text-2xs text-muted-foreground">
              {translate('testRuns.sharedCodeChanged', 'Shared code changed: {{files}}', {
                files:
                  featureScope.changedOtherFiles.slice(0, 5).join(', ') +
                  (featureScope.changedOtherFiles.length > 5 ? ', …' : '')
              })}
            </p>
          ) : null}
          {visibleRows.length === 0 ? (
            <PanelMessage>
              {translate(
                'testRuns.empty',
                'No test runs in this workspace yet. Runs started in Orca terminals appear here.'
              )}
            </PanelMessage>
          ) : (
            <TestResultsList
              rows={visibleRows}
              knownBugAnnotations={repoSettings.knownBugAnnotations}
              tierPattern={repoSettings.tierPattern}
              selectedIdentity={selectedIdentity}
              onSelect={(row) => setSelectedIdentity(row.identity)}
              picked={picked ?? undefined}
              onTogglePick={(identity) =>
                setPicked((current) => {
                  const next = new Set(current)
                  if (next.has(identity)) {
                    next.delete(identity)
                  } else {
                    next.add(identity)
                  }
                  return next
                })
              }
              onRunGroup={(folder, groupConfigFile) =>
                controls.launch(getSelectionForFolder(folder), groupConfigFile)
              }
            />
          )}
        </>
      )}
    </div>
  )
}
