import type { TestCatalogEntry } from '../../../../shared/test-runs/test-catalog-types'
import type { TestLabel, TestResultEntry } from './test-results-grouping'

/** One test of the panel: listed by Playwright, run before, or both. */
export type TestRow = {
  identity: string
  catalog: TestCatalogEntry | null
  latest: TestResultEntry | null
}

export function buildTestRows(catalog: TestCatalogEntry[], results: TestResultEntry[]): TestRow[] {
  const latestByIdentity = new Map(results.map((entry) => [entry.result.identity, entry]))
  const rows: TestRow[] = catalog.map((entry) => ({
    identity: entry.identity,
    catalog: entry,
    latest: latestByIdentity.get(entry.identity) ?? null
  }))
  const listed = new Set(catalog.map((entry) => entry.identity))
  for (const entry of results) {
    if (!listed.has(entry.result.identity)) {
      rows.push({ identity: entry.result.identity, catalog: null, latest: entry })
    }
  }
  return rows
}

export function getRowFile(row: TestRow): string {
  return row.catalog?.file ?? row.latest?.result.file ?? ''
}

export function getRowConfigFile(row: TestRow): string {
  return row.catalog?.configFile ?? row.latest?.result.configFile ?? 'playwright.config.ts'
}

export function getRowLine(row: TestRow): number {
  return row.catalog?.line ?? row.latest?.result.line ?? 0
}

export function getRowTitlePath(row: TestRow): string[] {
  return row.catalog?.titlePath ?? row.latest?.result.titlePath ?? []
}

export function getRowLabels(
  row: TestRow,
  settings: { knownBugAnnotations: string[] }
): TestLabel[] {
  const annotations = [
    ...(row.catalog?.annotations ?? []),
    ...(row.latest?.result.annotations ?? [])
  ]
  const knownBugs = [
    ...new Set(
      annotations
        .filter((annotation) => settings.knownBugAnnotations.includes(annotation.type))
        .map((annotation) => annotation.description ?? '')
    )
  ]
  const isExpectedFail =
    annotations.some((annotation) => annotation.type === 'fail') ||
    row.latest?.result.expectedStatus === 'failed'
  const tags = [...new Set([...(row.catalog?.tags ?? []), ...(row.latest?.result.tags ?? [])])]
  const project = row.catalog?.project ?? row.latest?.result.project ?? ''
  return [
    ...knownBugs.map((text): TestLabel => ({ kind: 'known-bug', text })),
    ...(isExpectedFail ? [{ kind: 'expected-fail' as const, text: '' }] : []),
    ...(row.catalog?.isSerial ? [{ kind: 'serial' as const, text: '' }] : []),
    ...tags.map((text): TestLabel => ({ kind: 'tag', text })),
    ...(project ? [{ kind: 'project' as const, text: project }] : [])
  ]
}
