import type { HulyStatusCategory } from './huly-types'

export type HulyStatusRule = {
  /** null = do not change the status */
  target: string | null
  fromStatusNames: string[]
  fromCategories: HulyStatusCategory[]
}

export type HulyMissionEvent = 'layer-created' | 'stack-pr-created' | 'stack-merged'

export type HulyProjectSettings = {
  /** Huly component id -> Orca repo id */
  componentRepoMap: Record<string, string>
  skipStatusNames: string[]
  statusWriteBack: boolean
  statusRules: Record<HulyMissionEvent, HulyStatusRule>
}

export type HulyGlobalSettings = {
  /** Per-project mission settings keyed by Huly project identifier. */
  hulyProjects: Record<string, HulyProjectSettings>
}

const HULY_MISSION_EVENTS: readonly HulyMissionEvent[] = [
  'layer-created',
  'stack-pr-created',
  'stack-merged'
]

const HULY_STATUS_CATEGORIES: readonly HulyStatusCategory[] = [
  'UnStarted',
  'ToDo',
  'Active',
  'Won',
  'Lost'
]

function defaultHulyProjectSettings(): HulyProjectSettings {
  return {
    componentRepoMap: {},
    skipStatusNames: ['MERGED IN MILESTONE'],
    statusWriteBack: false,
    statusRules: {
      'layer-created': {
        target: 'In Progress',
        fromStatusNames: [],
        fromCategories: ['UnStarted', 'ToDo']
      },
      'stack-pr-created': {
        target: 'CODE REVIEW',
        fromStatusNames: ['In Progress', 'Rozpracováno'],
        fromCategories: []
      },
      'stack-merged': {
        target: 'TESTOVÁNÍ',
        fromStatusNames: ['CODE REVIEW', 'Review in progress'],
        fromCategories: []
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : fallback
}

function isHulyStatusCategory(value: unknown): value is HulyStatusCategory {
  return HULY_STATUS_CATEGORIES.some((category) => category === value)
}

function normalizeStatusRule(value: unknown, fallback: HulyStatusRule): HulyStatusRule {
  if (!isRecord(value)) {
    return fallback
  }
  return {
    target:
      value.target === null || typeof value.target === 'string' ? value.target : fallback.target,
    fromStatusNames: stringArray(value.fromStatusNames, fallback.fromStatusNames),
    fromCategories: Array.isArray(value.fromCategories)
      ? value.fromCategories.filter(isHulyStatusCategory)
      : fallback.fromCategories
  }
}

function normalizeComponentRepoMap(value: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  if (isRecord(value)) {
    for (const [componentId, repoId] of Object.entries(value)) {
      if (typeof repoId === 'string') {
        map[componentId] = repoId
      }
    }
  }
  return map
}

function normalizeHulyProject(value: unknown): HulyProjectSettings | null {
  if (!isRecord(value)) {
    return null
  }
  const defaults = defaultHulyProjectSettings()
  const rules = isRecord(value.statusRules) ? value.statusRules : {}
  const statusRules = { ...defaults.statusRules }
  for (const event of HULY_MISSION_EVENTS) {
    statusRules[event] = normalizeStatusRule(rules[event], defaults.statusRules[event])
  }
  return {
    componentRepoMap: normalizeComponentRepoMap(value.componentRepoMap),
    skipStatusNames: stringArray(value.skipStatusNames, defaults.skipStatusNames),
    statusWriteBack:
      typeof value.statusWriteBack === 'boolean' ? value.statusWriteBack : defaults.statusWriteBack,
    statusRules
  }
}

export function normalizeHulyProjects(value: unknown): Record<string, HulyProjectSettings> {
  const projects: Record<string, HulyProjectSettings> = {}
  if (!isRecord(value)) {
    return projects
  }
  for (const [identifier, raw] of Object.entries(value)) {
    const project = normalizeHulyProject(raw)
    if (project) {
      projects[identifier] = project
    }
  }
  return projects
}

export function normalizeHulyProjectsUpdate(
  updates: Partial<HulyGlobalSettings>
): Partial<HulyGlobalSettings> {
  return 'hulyProjects' in updates
    ? { hulyProjects: normalizeHulyProjects(updates.hulyProjects) }
    : {}
}

export function getHulyProjectSettings(
  settings: Partial<HulyGlobalSettings>,
  project: string
): HulyProjectSettings {
  return normalizeHulyProject(settings.hulyProjects?.[project]) ?? defaultHulyProjectSettings()
}
