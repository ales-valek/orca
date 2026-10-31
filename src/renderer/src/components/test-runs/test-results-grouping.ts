import { getTestTier } from '../../../../shared/test-runs/test-identity'
import {
  getTestResultState,
  type TestResultState
} from '../../../../shared/test-runs/test-result-state'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'
import { getRowFile, getRowTitlePath, type TestRow } from './test-rows'

export type TestResultEntry = { result: TestResultRecord; run: TestRunRecord }

export type TestResultCounts = { passed: number; failed: number; skipped: number }

export type TestLabel = {
  kind: 'tag' | 'known-bug' | 'expected-fail' | 'serial' | 'project'
  text: string
}

export { getTestResultState, type TestResultState }

function getSpecFolder(file: string): string {
  const index = file.lastIndexOf('/')
  return index === -1 ? '.' : file.slice(0, index)
}

export function countTestResults(entries: TestResultEntry[]): TestResultCounts {
  const counts: TestResultCounts = { passed: 0, failed: 0, skipped: 0 }
  for (const entry of entries) {
    counts[getTestResultState(entry.result)]++
  }
  return counts
}

export type TestRowState = TestResultState | 'neverRun'

export type TestRowGroup = {
  key: string
  /** Spec folder relative to the repo root. */
  label: string
  tier: number | null
  counts: Record<TestRowState, number>
  rows: TestRow[]
}

export function getTestRowState(row: TestRow): TestRowState {
  return row.latest ? getTestResultState(row.latest.result) : 'neverRun'
}

const ROW_STATE_ORDER: Record<TestRowState, number> = {
  failed: 0,
  passed: 1,
  skipped: 2,
  neverRun: 3
}

/** Groups by spec folder; failing groups and tests come first, tests that never ran last. */
export function groupTestRows(rows: TestRow[], options: { tierPattern?: RegExp }): TestRowGroup[] {
  const byFolder = new Map<string, TestRow[]>()
  for (const row of rows) {
    const folder = getSpecFolder(getRowFile(row))
    const items = byFolder.get(folder)
    if (items) {
      items.push(row)
    } else {
      byFolder.set(folder, [row])
    }
  }
  return [...byFolder.entries()]
    .map(([folder, items]) => {
      const counts: Record<TestRowState, number> = { passed: 0, failed: 0, skipped: 0, neverRun: 0 }
      for (const row of items) {
        counts[getTestRowState(row)]++
      }
      return {
        key: folder,
        label: folder,
        tier: getTestTier(`${folder}/`, options.tierPattern),
        counts,
        // Why keyed once: ~1,300 rows would otherwise rebuild titles inside every comparison.
        rows: items
          .map((row) => ({
            row,
            order: ROW_STATE_ORDER[getTestRowState(row)],
            title: getRowTitlePath(row).join(' ')
          }))
          .toSorted((a, b) => a.order - b.order || a.title.localeCompare(b.title))
          .map((item) => item.row)
      }
    })
    .toSorted(
      (a, b) =>
        Number(b.counts.failed > 0) - Number(a.counts.failed > 0) || a.label.localeCompare(b.label)
    )
}
