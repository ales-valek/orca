import { slugifyMissionText } from './missions'
import type { Mission, MissionSlot, MissionTask } from './mission-types'

const MISSION_BRANCH_PREFIX = 'mission/'
const PREVIEW_BRANCH_PREFIX = 'mission-preview/'
const TASK_BRANCH_PREFIX = 'mission-task/'
// Why: the task slug names its root directory suffix, which these slots already use.
const RESERVED_TASK_SLUGS = new Set(['preview', 'orchestrator'])

/** Branch-safe identity of a mission, shared by its preview and task branches. */
export function getMissionBranchSlug(missionBranch: string): string {
  const withoutPrefix = missionBranch.startsWith(MISSION_BRANCH_PREFIX)
    ? missionBranch.slice(MISSION_BRANCH_PREFIX.length)
    : missionBranch
  return slugifyMissionText(withoutPrefix.replace(/\/+/g, '-')) || 'mission'
}

export function getMissionPreviewBranch(mission: Pick<Mission, 'branchName'>): string {
  return `${PREVIEW_BRANCH_PREFIX}${getMissionBranchSlug(mission.branchName)}`
}

export function createMissionTaskBranchName(
  mission: Pick<Mission, 'branchName' | 'tasks'>,
  seed: { title: string; externalRef?: string | null }
): string {
  const taskSlug =
    slugifyMissionText(seed.externalRef ?? '') || slugifyMissionText(seed.title) || 'task'
  const prefix = `${TASK_BRANCH_PREFIX}${getMissionBranchSlug(mission.branchName)}/`
  const taken = new Set((mission.tasks ?? []).map((task) => task.branchName))
  let candidate = taskSlug
  for (
    let suffix = 2;
    taken.has(`${prefix}${candidate}`) || RESERVED_TASK_SLUGS.has(candidate);
    suffix += 1
  ) {
    candidate = `${taskSlug}-${suffix}`
  }
  return `${prefix}${candidate}`
}

export function getRepoTaskStack(mission: Pick<Mission, 'tasks'>, repoId: string): MissionTask[] {
  return (mission.tasks ?? [])
    .filter((task) => task.repoId === repoId)
    .sort((left, right) => left.order - right.order)
}

export function getTopMissionTask(
  mission: Pick<Mission, 'tasks'>,
  repoId: string
): MissionTask | null {
  return getRepoTaskStack(mission, repoId).at(-1) ?? null
}

/** Parent is derived from `order`: 1 = mission branch, n = layer n-1 of the same repo. */
export function getMissionTaskParentBranch(
  mission: Pick<Mission, 'branchName' | 'tasks'>,
  task: Pick<MissionTask, 'repoId' | 'order'>
): string {
  const parent = getRepoTaskStack(mission, task.repoId).findLast(
    (candidate) => candidate.order < task.order
  )
  return parent?.branchName ?? mission.branchName
}

export function isMissionSlot(value: unknown): value is MissionSlot {
  return (
    value === 'member' ||
    value === 'preview' ||
    value === 'orchestrator' ||
    (typeof value === 'string' && value.startsWith('task:') && value.length > 'task:'.length)
  )
}

/** Persisted slot stamps omit `'member'`, so only these values may appear on disk. */
export function isNonMemberMissionSlot(value: unknown): value is Exclude<MissionSlot, 'member'> {
  return value !== 'member' && isMissionSlot(value)
}

export function getMissionSlotBranch(
  mission: Mission,
  repoId: string,
  slot: MissionSlot
): string | null {
  if (slot === 'member') {
    return mission.members.some((member) => member.repoId === repoId) ? mission.branchName : null
  }
  if (slot === 'preview') {
    // Why: the preview is created before its record, so a member repo with tasks already owns it.
    const isPreviewRepo =
      mission.members.some((member) => member.repoId === repoId) &&
      (getRepoTaskStack(mission, repoId).length > 0 ||
        Boolean(mission.previews?.some((preview) => preview.repoId === repoId)))
    return isPreviewRepo ? getMissionPreviewBranch(mission) : null
  }
  if (slot === 'orchestrator') {
    return mission.orchestratorRepoId === repoId ? mission.branchName : null
  }
  const taskId = slot.slice('task:'.length)
  return (
    (mission.tasks ?? []).find((task) => task.id === taskId && task.repoId === repoId)
      ?.branchName ?? null
  )
}
