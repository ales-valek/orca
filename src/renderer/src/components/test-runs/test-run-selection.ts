import type {
  TestRunSourceOption,
  TestRunTargetOption
} from '../../../../shared/test-runs/test-run-launch-types'
import type { TestRunSelection } from '../../../../shared/test-runs/test-run-launch-types'
import { getTestResultState, type TestResultEntry } from './test-results-grouping'
import { getRowFile, getRowLine, type TestRow } from './test-rows'

export function getSelectionForTests(entries: TestResultEntry[]): TestRunSelection {
  const locations = [
    ...new Set(entries.map((entry) => `${entry.result.file}:${entry.result.line}`))
  ]
  return { kind: 'tests', locations }
}

/** Picked rows: Playwright's listed location, else the last run's. */
export function getSelectionForRows(rows: TestRow[]): TestRunSelection {
  const locations = rows.flatMap((row) =>
    row.catalog || row.latest ? [`${getRowFile(row)}:${getRowLine(row)}`] : []
  )
  return { kind: 'tests', locations: [...new Set(locations)] }
}

export function getSelectionForFailed(entries: TestResultEntry[]): TestRunSelection {
  return getSelectionForTests(
    entries.filter((entry) => getTestResultState(entry.result) === 'failed')
  )
}

export function getSelectionForFolder(folder: string): TestRunSelection {
  return { kind: 'paths', paths: [folder.endsWith('/') ? folder : `${folder}/`] }
}

function isCaptureGroupStart(source: string, index: number): boolean {
  if (source[index + 1] !== '?') {
    return true
  }
  // Named groups capture too; (?<= and (?<! are lookbehinds.
  return source[index + 2] === '<' && source[index + 3] !== '=' && source[index + 3] !== '!'
}

/** End of the group opened at `index`, skipping escapes and character classes. */
function findGroupEnd(source: string, index: number): number {
  let depth = 0
  for (let end = index; end < source.length; end++) {
    if (source[end] === '\\') {
      end++
    } else if (source[end] === '[') {
      end = findClassEnd(source, end)
    } else if (source[end] === '(') {
      depth++
    } else if (source[end] === ')' && --depth === 0) {
      return end
    }
  }
  return -1
}

function findClassEnd(source: string, index: number): number {
  for (let end = index + 1; end < source.length; end++) {
    if (source[end] === '\\') {
      end++
    } else if (source[end] === ']') {
      return end
    }
  }
  return source.length
}

/** The pattern's first capture group (the tier number) swapped for `replacement`. */
function replaceFirstCaptureGroup(source: string, replacement: string): string {
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\') {
      index++
    } else if (source[index] === '[') {
      index = findClassEnd(source, index)
    } else if (source[index] === '(' && isCaptureGroupStart(source, index)) {
      const end = findGroupEnd(source, index)
      if (end !== -1) {
        return source.slice(0, index) + replacement + source.slice(end + 1)
      }
    }
  }
  return source
}

/**
 * Playwright reads each path argument as a regular expression, so the repo's own tier pattern
 * selects a tier (and, when tiers are cumulative, every lower one) in any folder layout.
 */
export function getSelectionForTier(
  tier: number,
  options: { tierPattern: RegExp; cumulative?: boolean }
): TestRunSelection {
  const tiers = options.cumulative ? Array.from({ length: tier }, (_, index) => index + 1) : [tier]
  // Why the lookahead: tier-1 must not also select tier-10…19.
  let pattern = replaceFirstCaptureGroup(
    options.tierPattern.source,
    `(?:${tiers.join('|')})(?!\\d)`
  )
  // Why: Playwright matches against absolute paths, so a start anchor would match nothing.
  if (pattern.startsWith('^')) {
    pattern = `(?:^|/)${pattern.slice(1)}`
  }
  // Why: an argument starting with a dash would reach Playwright as an option.
  return { kind: 'paths', paths: [pattern.startsWith('-') ? `(?:)${pattern}` : pattern] }
}

export function getDefaultTarget(
  targets: TestRunTargetOption[],
  devEnvId: string | null
): string | null {
  const own = targets.find(
    (option) => option.target.kind === 'dev-env' && option.target.devEnvId === devEnvId
  )
  return (own ?? targets[0])?.id ?? null
}

export function getDefaultSource(
  sources: TestRunSourceOption[],
  repoId: string | null,
  context: { isPreset: boolean; worktreeId: string | null } = { isPreset: false, worktreeId: null }
): string | null {
  // Why first: an open test-repo worktree is what the user (or agent) is changing right now.
  const own = sources.find((source) => source.id === `worktree:${context.worktreeId}`)
  if (own) {
    return own.id
  }
  // Why: a shared preset needs a worktree's own env files; origin/main has none.
  if (context.isPreset) {
    const worktrees = sources.filter((source) => source.kind === 'worktree')
    const preferred =
      worktrees.find((source) => source.id === `worktree:${context.worktreeId}`) ??
      worktrees.find((source) => source.repoId === repoId) ??
      worktrees[0]
    if (preferred) {
      return preferred.id
    }
  }
  const preferred =
    sources.find((source) => source.kind === 'origin-main' && source.repoId === repoId) ??
    sources.find((source) => source.kind === 'origin-main') ??
    sources[0]
  return preferred?.id ?? null
}
