import { translate } from '@/i18n/i18n'
import React, { useEffect, useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getRepoKey } from '../../../../shared/test-runs/test-identity'
import type { TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { getWorktreePathBasenameFromId } from '../../../../shared/worktree/id'
import { DevEnvStatusDot } from '../dev-env/DevEnvStatusDot'
import { summarizeRepoTiers, summarizeWorkspaces } from './test-runs-overview'
import { TestResultDetail } from './TestResultDetail'
import { TestResultsList, getRunAge, getTriggerLabel } from './TestResultsList'
import { useRecentRuns, useTestRuns } from './use-test-runs'

function getWorkspaceName(worktreeId: string | null): string | null {
  return worktreeId ? (getWorktreePathBasenameFromId(worktreeId) ?? worktreeId) : null
}

function getRepoChoices(runs: TestRunRecord[]): { key: string; label: string }[] {
  const choices = new Map<string, string>()
  for (const run of runs) {
    const key = getRepoKey(run.repo)
    choices.set(key, choices.get(key) ?? key.split('/').at(-1) ?? key)
  }
  return [...choices.entries()].map(([key, label]) => ({ key, label }))
}

function openWorkspaceTests(worktreeId: string): void {
  activateAndRevealWorktree(worktreeId)
  const state = useAppStore.getState()
  state.setRightSidebarTab('tests')
  state.setRightSidebarOpen(true)
}

/** Every repo's latest Playwright results by tier, and which workspaces ran tests last. */
export default function TestRunsPage(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const allRuns = useRecentRuns()
  const repos = useMemo(() => getRepoChoices(allRuns ?? []), [allRuns])
  const [repoKey, setRepoKey] = useState<string | null>(null)
  const effectiveRepoKey = repoKey ?? repos[0]?.key ?? null
  const scope = useMemo(
    () => (effectiveRepoKey ? { repoKey: effectiveRepoKey } : null),
    [effectiveRepoKey]
  )
  const { entries, runs } = useTestRuns(scope)
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null)
  useEffect(() => setSelectedIdentity(null), [effectiveRepoKey])

  const selected = entries?.find((entry) => entry.result.identity === selectedIdentity)
  const tiers = summarizeRepoTiers(entries ?? [], {})
  const workspaces = summarizeWorkspaces(runs ?? [])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h1 className="flex-1 text-[15px] font-semibold">{translate('testRuns.title', 'Tests')}</h1>
        {repos.length > 1 && effectiveRepoKey ? (
          <Select value={effectiveRepoKey} onValueChange={setRepoKey}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {repos.map((repo) => (
                <SelectItem key={repo.key} value={repo.key}>
                  {repo.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {allRuns !== null && repos.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4 text-sm text-muted-foreground">
          <FlaskConical className="size-4" />
          {translate(
            'testRuns.pageEmpty',
            'No test runs yet. Playwright runs started in Orca terminals appear here once the test repo opts in.'
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="scrollbar-sleek flex min-h-0 w-1/2 flex-col gap-4 overflow-y-auto border-r border-border p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {tiers.map((tier) => (
                <div
                  key={tier.tier ?? 'none'}
                  className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 text-xs"
                >
                  <span className="text-[13px] font-medium">
                    {tier.tier === null
                      ? translate('testRuns.noTier', 'Without tier')
                      : translate('testRuns.tier', 'Tier {{tier}}', { tier: tier.tier })}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <DevEnvStatusDot tone="ok" />
                      {tier.passed}
                    </span>
                    <span className="flex items-center gap-1">
                      <DevEnvStatusDot tone="error" />
                      {tier.failed}
                    </span>
                    <span className="flex items-center gap-1">
                      <DevEnvStatusDot tone="muted" />
                      {tier.skipped}
                    </span>
                  </span>
                  {tier.lastRunAt !== null ? (
                    <span className="text-2xs text-muted-foreground">
                      {getRunAge(tier.lastRunAt)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {workspaces.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {translate('testRuns.workspaces', 'Workspaces')}
                </span>
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.worktreeId}
                    type="button"
                    onClick={() => openWorkspaceTests(workspace.worktreeId)}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                  >
                    <DevEnvStatusDot tone={workspace.failedTests > 0 ? 'error' : 'ok'} />
                    <span className="min-w-0 flex-1 truncate">
                      {getWorkspaceName(workspace.worktreeId)}
                    </span>
                    <span className="text-2xs text-muted-foreground">
                      {workspace.failedTests > 0
                        ? translate('testRuns.failedCount', '{{count}} failed', {
                            count: workspace.failedTests
                          })
                        : null}
                      {' · '}
                      {getRunAge(workspace.lastRun.startedAt)} ·{' '}
                      {getTriggerLabel(workspace.lastRun.trigger)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="scrollbar-sleek min-h-0 w-1/2 overflow-y-auto">
            {selected ? (
              <TestResultDetail
                entry={selected}
                traceWorktreeId={selected.run.worktreeId ?? activeWorktreeId}
                onBack={() => setSelectedIdentity(null)}
              />
            ) : (
              <TestResultsList
                entries={entries ?? []}
                selectedIdentity={selectedIdentity}
                onSelect={(entry) => setSelectedIdentity(entry.result.identity)}
                getWorkspaceName={(entry) => getWorkspaceName(entry.run.worktreeId)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
