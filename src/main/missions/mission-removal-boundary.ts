import type { Mission, MissionSlot } from '../../shared/mission-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import { areWorktreePathsEqual } from '../git/worktree-path-comparison'
import { readMissionWorktreeCreateIntent } from './mission-worktree-create-intent'
import { readMissionWorktreeOwnershipMarker } from './mission-worktree-ownership-marker'

export const MISSION_MANAGED_MEMBER_REMOVAL_ERROR = 'mission_member_managed_by_mission'

/** Slots a repo's Mission worktree may fill, including the preview, whose record is written after create. */
function getGuardedRepoSlots(mission: Mission, repoId: string): MissionSlot[] {
  const slots: MissionSlot[] = mission.members.some((member) => member.repoId === repoId)
    ? ['member', 'preview']
    : []
  for (const task of mission.tasks ?? []) {
    if (task.repoId === repoId) {
      slots.push(`task:${task.id}`)
    }
  }
  if (mission.orchestratorRepoId === repoId) {
    slots.push('orchestrator')
  }
  return slots
}

function isMissionRecordedWorktree(mission: Mission, worktreeId: string): boolean {
  return [
    ...mission.members,
    ...(mission.tasks ?? []),
    ...(mission.previews ?? []),
    ...(mission.orchestrator ? [mission.orchestrator] : [])
  ].some((record) => record.worktreeId === worktreeId)
}

type MissionRemovalBoundaryReader = {
  getMissions?: () => Mission[]
  getWorktreeMeta: (worktreeId: string) => WorktreeMeta | undefined
}

export function assertWorktreeIsNotMissionManaged(
  store: MissionRemovalBoundaryReader,
  worktreeId: string,
  localGitTarget?: { repoPath: string; worktreePath: string }
): void {
  const metadataOwner = store.getWorktreeMeta(worktreeId)?.missionId
  const missions = store.getMissions?.()
  const memberOwner = missions?.find((mission) =>
    isMissionRecordedWorktree(mission, worktreeId)
  )?.id
  const parsedWorktreeId = splitWorktreeId(worktreeId)
  const intentOwner =
    localGitTarget && parsedWorktreeId
      ? missions?.find((mission) => {
          const rootPath = mission.rootPath
          const baseDir = mission.rootBasePath
          if (!rootPath || !baseDir) {
            return false
          }
          return getGuardedRepoSlots(mission, parsedWorktreeId.repoId).some((slot) => {
            const intent = readMissionWorktreeCreateIntent(
              { baseDir, rootPath, missionId: mission.id },
              parsedWorktreeId.repoId,
              ...(slot === 'member' ? [] : [slot])
            )
            return (
              intent !== null &&
              areWorktreePathsEqual(intent.worktreePath, localGitTarget.worktreePath)
            )
          })
        })?.id
      : undefined
  // Why: after Mission deletion, a crash may leave only stale metadata; an
  // authoritative Mission list lets generic cleanup recover that orphan.
  const liveMetadataOwner =
    metadataOwner !== undefined &&
    (missions === undefined || missions.some((mission) => mission.id === metadataOwner))
  const marker = localGitTarget ? readMissionWorktreeOwnershipMarker(localGitTarget) : null
  if (marker) {
    const parsedMarkerId = splitWorktreeId(marker.worktreeId)
    if (
      !localGitTarget ||
      parsedMarkerId?.repoId !== marker.repoId ||
      !areWorktreePathsEqual(parsedMarkerId.worktreePath, localGitTarget.worktreePath)
    ) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
  }
  const liveMarkerOwner =
    marker !== null &&
    (missions === undefined ||
      missions.some(
        (mission) =>
          mission.id === marker.missionId && getGuardedRepoSlots(mission, marker.repoId).length > 0
      ))
  if (liveMetadataOwner || memberOwner || intentOwner || liveMarkerOwner) {
    // Why: only Mission lifecycle deletion verifies the durable ownership stamp
    // and updates the member record atomically with checkout removal.
    throw new Error(MISSION_MANAGED_MEMBER_REMOVAL_ERROR)
  }
}

export function assertRepoIsNotMissionManaged(missions: Mission[], repoId: string): void {
  if (missions.some((mission) => getGuardedRepoSlots(mission, repoId).length > 0)) {
    // Why: generic project removal prunes worktree metadata without updating
    // Mission membership, leaving an in-root checkout with no ownership proof.
    throw new Error(MISSION_MANAGED_MEMBER_REMOVAL_ERROR)
  }
}
