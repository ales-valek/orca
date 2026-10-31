import { useCallback, useEffect, useState } from 'react'
import type { TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import type { TestResultEntry } from './test-results-grouping'

export type TestRunsScope = { worktreeId?: string; repoKey?: string }

/** Latest result per test and recent runs for a scope; reloads when the reporter writes. */
export function useTestRuns(scope: TestRunsScope | null): {
  entries: TestResultEntry[] | null
  runs: TestRunRecord[] | null
} {
  const [entries, setEntries] = useState<TestResultEntry[] | null>(null)
  const [runs, setRuns] = useState<TestRunRecord[] | null>(null)
  const worktreeId = scope?.worktreeId
  const repoKey = scope?.repoKey
  const isEnabled = scope !== null

  const load = useCallback(async () => {
    if (!isEnabled) {
      return
    }
    try {
      const [latest, recent] = await Promise.all([
        window.api.testRuns.getLatestResults({ worktreeId, repoKey }),
        window.api.testRuns.listRuns({ worktreeId, repoKey, limit: 50 })
      ])
      setEntries(latest)
      setRuns(recent)
    } catch (error) {
      console.error('[test-runs] load failed', error)
      setEntries([])
      setRuns([])
    }
  }, [isEnabled, worktreeId, repoKey])

  useEffect(() => {
    setEntries(null)
    setRuns(null)
    void load()
    return window.api.testRuns.onChanged(() => void load())
  }, [load])

  return { entries, runs }
}

/** Runs of every repo, without their results: enough to list repos and workspaces. */
export function useRecentRuns(): TestRunRecord[] | null {
  const [runs, setRuns] = useState<TestRunRecord[] | null>(null)
  useEffect(() => {
    const load = (): void =>
      void window.api.testRuns
        .listRuns({ limit: 50 })
        .then(setRuns)
        .catch(() => setRuns([]))
    load()
    return window.api.testRuns.onChanged(load)
  }, [])
  return runs
}

export function useTestHistory(identity: string): TestResultEntry[] | null {
  const [history, setHistory] = useState<TestResultEntry[] | null>(null)
  useEffect(() => {
    let isCurrent = true
    setHistory(null)
    void window.api.testRuns
      .getHistory({ identity })
      .then((result) => isCurrent && setHistory(result))
      .catch(() => isCurrent && setHistory([]))
    return () => {
      isCurrent = false
    }
  }, [identity])
  return history
}
