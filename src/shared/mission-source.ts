import type { Mission, MissionSource } from './mission-types'

export const MISSION_BRIEF_FILE_NAME = 'MISSION.md'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function normalizeImportedOrder(value: unknown): Record<string, string[]> {
  const order: Record<string, string[]> = {}
  if (!value || typeof value !== 'object') {
    return order
  }
  for (const [repoId, identifiers] of Object.entries(value)) {
    if (Array.isArray(identifiers)) {
      order[repoId] = identifiers.filter(isNonEmptyString)
    }
  }
  return order
}

/** Legacy missions have no source; an invalid one is dropped rather than half-kept. */
export function normalizeMissionSource(value: unknown): Pick<Mission, 'source'> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const raw: Record<string, unknown> = { ...value }
  if (
    raw.provider !== 'huly' ||
    !isNonEmptyString(raw.serverUrl) ||
    !isNonEmptyString(raw.workspace) ||
    !isNonEmptyString(raw.project) ||
    !isNonEmptyString(raw.milestoneId)
  ) {
    return {}
  }
  return {
    source: {
      provider: 'huly',
      serverUrl: raw.serverUrl,
      workspace: raw.workspace,
      project: raw.project,
      milestoneId: raw.milestoneId,
      milestoneLabel: typeof raw.milestoneLabel === 'string' ? raw.milestoneLabel : '',
      milestoneUrl: typeof raw.milestoneUrl === 'string' ? raw.milestoneUrl : '',
      importedOrder: normalizeImportedOrder(raw.importedOrder),
      lastSyncedAt:
        typeof raw.lastSyncedAt === 'number' && Number.isFinite(raw.lastSyncedAt)
          ? raw.lastSyncedAt
          : 0
    } satisfies MissionSource
  }
}

/** Separator-agnostic join so the renderer and main agree without node:path. */
export function getMissionBriefPath(mission: Pick<Mission, 'rootPath' | 'source'>): string | null {
  if (!mission.source || !mission.rootPath) {
    return null
  }
  const separator = mission.rootPath.includes('\\') && !mission.rootPath.includes('/') ? '\\' : '/'
  return `${mission.rootPath.replace(/[\\/]+$/, '')}${separator}${MISSION_BRIEF_FILE_NAME}`
}
