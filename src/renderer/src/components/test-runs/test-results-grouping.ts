import { getTestTier } from '../../../../shared/test-runs/test-identity'
import type { TestResultRecord, TestRunRecord } from '../../../../shared/test-runs/test-run-types'

export type TestResultEntry = { result: TestResultRecord; run: TestRunRecord }

export type TestResultCounts = { passed: number; failed: number; skipped: number }

export type TestResultGroup = {
  key: string
  /** Spec folder relative to the repo root. */
  label: string
  tier: number | null
  counts: TestResultCounts
  entries: TestResultEntry[]
}

export type TestLabel = {
  kind: 'tag' | 'known-bug' | 'expected-fail' | 'project'
  text: string
}

export type TestResultState = keyof TestResultCounts

export function getTestResultState(result: TestResultRecord): TestResultState {
  if (result.outcome === 'unexpected') {
    return 'failed'
  }
  return result.status === 'skipped' ? 'skipped' : 'passed'
}

const STATE_ORDER: Record<TestResultState, number> = { failed: 0, passed: 1, skipped: 2 }

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

/** Groups by spec folder; failing groups and tests come first. */
export function groupTestResults(
  entries: TestResultEntry[],
  options: { tierPattern?: RegExp }
): TestResultGroup[] {
  const byFolder = new Map<string, TestResultEntry[]>()
  for (const entry of entries) {
    const folder = getSpecFolder(entry.result.file)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), entry])
  }
  return [...byFolder.entries()]
    .map(([folder, items]) => ({
      key: folder,
      label: folder,
      tier: getTestTier(`${folder}/`, options.tierPattern),
      counts: countTestResults(items),
      entries: items.toSorted(
        (a, b) =>
          STATE_ORDER[getTestResultState(a.result)] - STATE_ORDER[getTestResultState(b.result)] ||
          a.result.titlePath.join(' ').localeCompare(b.result.titlePath.join(' '))
      )
    }))
    .toSorted(
      (a, b) =>
        Number(b.counts.failed > 0) - Number(a.counts.failed > 0) || a.label.localeCompare(b.label)
    )
}

export function getTestLabels(result: TestResultRecord): TestLabel[] {
  const labels: TestLabel[] = result.annotations
    .filter((annotation) => annotation.type === 'bug-pin')
    .map((annotation) => ({ kind: 'known-bug', text: annotation.description ?? '' }))
  if (result.expectedStatus === 'failed') {
    labels.push({ kind: 'expected-fail', text: '' })
  }
  labels.push(...result.tags.map((tag): TestLabel => ({ kind: 'tag', text: tag })))
  if (result.project) {
    labels.push({ kind: 'project', text: result.project })
  }
  return labels
}
