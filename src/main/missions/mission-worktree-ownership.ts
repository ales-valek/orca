import type { Mission, MissionSlot } from '../../shared/mission-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence'

export type MissionOwnedWorktree = {
  worktreeId: string
  worktreeInstanceId: string
}

/** The Mission's own pointer to the worktree filling one slot of a repo. */
export type MissionSlotRecord = {
  repoId: string
  worktreeId: string | null
  worktreeInstanceId?: string | null
}

export function getMissionSlotRecord(
  mission: Pick<Mission, 'members' | 'tasks' | 'previews' | 'orchestratorRepoId' | 'orchestrator'>,
  repoId: string,
  slot: MissionSlot
): MissionSlotRecord | null {
  if (slot === 'member') {
    return mission.members.find((member) => member.repoId === repoId) ?? null
  }
  if (slot === 'preview') {
    return mission.previews?.find((preview) => preview.repoId === repoId) ?? null
  }
  if (slot === 'orchestrator') {
    return mission.orchestratorRepoId === repoId && mission.orchestrator?.repoId === repoId
      ? mission.orchestrator
      : null
  }
  const taskId = slot.slice('task:'.length)
  return (mission.tasks ?? []).find((task) => task.id === taskId && task.repoId === repoId) ?? null
}

/** Every slot of a repo that the Mission currently records, member first. */
export function getMissionRepoSlots(
  mission: Pick<Mission, 'members' | 'tasks' | 'previews' | 'orchestratorRepoId' | 'orchestrator'>,
  repoId: string
): MissionSlot[] {
  const slots: MissionSlot[] = []
  if (getMissionSlotRecord(mission, repoId, 'member')) {
    slots.push('member')
  }
  for (const task of mission.tasks ?? []) {
    if (task.repoId === repoId) {
      slots.push(`task:${task.id}`)
    }
  }
  for (const slot of ['preview', 'orchestrator'] as const) {
    if (getMissionSlotRecord(mission, repoId, slot)) {
      slots.push(slot)
    }
  }
  return slots
}

/** Persistence is untrusted input here: all three ownership stamps must agree
 * before a Mission may project, detach, or remove a worktree. */
export function getMissionOwnedWorktree(
  store: Store,
  mission: Pick<Mission, 'id'>,
  record: MissionSlotRecord
): MissionOwnedWorktree | null {
  if (!record.worktreeId || !record.worktreeInstanceId) {
    return null
  }
  const parsed = splitWorktreeId(record.worktreeId)
  const meta = store.getWorktreeMeta(record.worktreeId)
  if (
    parsed?.repoId !== record.repoId ||
    meta?.missionId !== mission.id ||
    meta.instanceId !== record.worktreeInstanceId
  ) {
    return null
  }
  return {
    worktreeId: record.worktreeId,
    worktreeInstanceId: record.worktreeInstanceId
  }
}

function findOwnedWorktrees(
  store: Store,
  missionId: string,
  repoId: string,
  matchesSlot: (meta: WorktreeMeta) => boolean
): MissionOwnedWorktree[] {
  const candidates: MissionOwnedWorktree[] = []
  for (const [worktreeId, meta] of Object.entries(store.getAllWorktreeMeta())) {
    const parsed = splitWorktreeId(worktreeId)
    if (
      parsed?.repoId !== repoId ||
      meta.missionId !== missionId ||
      !meta.instanceId ||
      !matchesSlot(meta)
    ) {
      continue
    }
    candidates.push({ worktreeId, worktreeInstanceId: meta.instanceId })
  }
  return candidates
}

/** Finds durable Mission-owned worktrees of one slot after a crash between
 * runtime create and slot-pointer persistence. The caller must still verify liveness. */
export function findMissionOwnedWorktreeCandidates(
  store: Store,
  missionId: string,
  repoId: string,
  slot: MissionSlot = 'member'
): MissionOwnedWorktree[] {
  return findOwnedWorktrees(
    store,
    missionId,
    repoId,
    (meta) => (meta.missionSlot ?? 'member') === slot
  )
}

/** Every worktree of the repo stamped for the Mission, whatever slot it claims. */
export function findMissionRepoOwnedWorktrees(
  store: Store,
  missionId: string,
  repoId: string
): MissionOwnedWorktree[] {
  return findOwnedWorktrees(store, missionId, repoId, () => true)
}
