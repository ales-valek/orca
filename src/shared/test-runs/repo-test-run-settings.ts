import { getStrings, isRecord } from '../dev-env/dev-env-settings-values'

/** How Orca reads one repo's tests; absent fields use the defaults below. */
export type RepoTestRunSettings = {
  /** Regex with one capture group for the tier number, matched against repo-relative paths. */
  tierPattern?: string
  /** Tier n includes the tests of every lower tier. */
  cumulativeTiers?: boolean
  /** Annotation types that mark a test as pinned to a known bug. */
  knownBugAnnotations?: string[]
}

const DEFAULT_TIER_PATTERN = /(?:^|\/)tier-(\d+)\//
const DEFAULT_KNOWN_BUG_ANNOTATIONS = ['bug-pin']

export function normalizeRepoTestRunSettings(value: unknown): RepoTestRunSettings | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const settings: RepoTestRunSettings = {}
  if (typeof value.tierPattern === 'string' && value.tierPattern.trim()) {
    settings.tierPattern = value.tierPattern.trim()
  }
  if (typeof value.cumulativeTiers === 'boolean') {
    settings.cumulativeTiers = value.cumulativeTiers
  }
  if (Array.isArray(value.knownBugAnnotations)) {
    settings.knownBugAnnotations = getStrings(value.knownBugAnnotations).filter(Boolean)
  }
  return settings
}

export function getTierPattern(settings: RepoTestRunSettings | undefined): RegExp {
  if (!settings?.tierPattern) {
    return DEFAULT_TIER_PATTERN
  }
  try {
    const pattern = new RegExp(settings.tierPattern)
    // Why: the tier number comes from the first capture group; the empty branch always
    // matches, so the result's length is 1 + the pattern's group count.
    const groupCount = (new RegExp(`(?:${pattern.source})|`).exec('')?.length ?? 1) - 1
    return groupCount > 0 ? pattern : DEFAULT_TIER_PATTERN
  } catch {
    return DEFAULT_TIER_PATTERN
  }
}

export function getKnownBugAnnotations(settings: RepoTestRunSettings | undefined): string[] {
  return settings?.knownBugAnnotations?.length
    ? settings.knownBugAnnotations
    : DEFAULT_KNOWN_BUG_ANNOTATIONS
}
