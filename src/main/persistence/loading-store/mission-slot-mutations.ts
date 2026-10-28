import type { Mission, MissionSlot, MissionSlotWorktree } from '../../../shared/mission-types'

type SlotEntry = {
  worktreeId: string | null
  worktreeInstanceId?: string | null
  lastError?: string | null
}

function ensureSingleSlot(mission: Mission, repoId: string, slot: 'preview' | 'orchestrator') {
  if (slot === 'orchestrator') {
    if (mission.orchestratorRepoId !== repoId) {
      return null
    }
    mission.orchestrator ??= { repoId, worktreeId: null, worktreeInstanceId: null, lastError: null }
    return mission.orchestrator
  }
  if (!mission.members.some((member) => member.repoId === repoId)) {
    return null
  }
  const previews = (mission.previews ??= [])
  let preview = previews.find((entry) => entry.repoId === repoId)
  if (!preview) {
    preview = { repoId, worktreeId: null, worktreeInstanceId: null, lastError: null }
    previews.push(preview)
  }
  return preview
}

function resolveSlotEntry(mission: Mission, repoId: string, slot: MissionSlot): SlotEntry | null {
  if (slot === 'member') {
    return mission.members.find((member) => member.repoId === repoId) ?? null
  }
  if (slot === 'preview' || slot === 'orchestrator') {
    return ensureSingleSlot(mission, repoId, slot)
  }
  const taskId = slot.slice('task:'.length)
  return (mission.tasks ?? []).find((task) => task.id === taskId && task.repoId === repoId) ?? null
}

// Why: an empty preview/orchestrator entry carries no state, so it is dropped.
function pruneEmptySlot(mission: Mission, repoId: string, slot: MissionSlot): void {
  const isEmpty = (entry: MissionSlotWorktree | null | undefined): boolean =>
    !entry || (!entry.worktreeId && !entry.lastError)
  if (slot === 'orchestrator' && isEmpty(mission.orchestrator)) {
    mission.orchestrator = null
  } else if (slot === 'preview') {
    mission.previews = (mission.previews ?? []).filter(
      (entry) => entry.repoId !== repoId || !isEmpty(entry)
    )
  }
}

/** Returns false when the slot cannot exist for this repo (nothing mutated). */
export function applyMissionSlotWorktree(
  mission: Mission,
  repoId: string,
  slot: MissionSlot,
  worktreeId: string | null,
  worktreeInstanceId: string | null
): boolean {
  const entry = resolveSlotEntry(mission, repoId, slot)
  if (!entry) {
    return false
  }
  entry.worktreeId = worktreeId
  entry.worktreeInstanceId = worktreeInstanceId
  entry.lastError = null
  pruneEmptySlot(mission, repoId, slot)
  return true
}

export function applyMissionSlotError(
  mission: Mission,
  repoId: string,
  slot: MissionSlot,
  error: string | null
): boolean {
  const entry = resolveSlotEntry(mission, repoId, slot)
  if (!entry) {
    return false
  }
  entry.lastError = error
  pruneEmptySlot(mission, repoId, slot)
  return true
}
