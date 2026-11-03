import { getMissionSlotBranch } from '../../shared/mission-task-stack'
import type { Mission, MissionMember, MissionSlot } from '../../shared/mission-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { areWorktreePathsEqual } from '../git/worktrees/catalog/worktree-path-comparison'
import { worktreePathComparisonKey } from '../workspaces/catalog/worktree-path-comparison-key'
import {
  findMissionOwnedWorktreeCandidates,
  getMissionRepoNonMemberSlots,
  getMissionSlotRecord,
  writeMissionSlotPointer,
  type MissionOwnedWorktree,
  type MissionSlotRecord
} from './mission-worktree-ownership'
import {
  assertMissionWorktreeOwnershipMarker,
  resolveMissionWorktreeBranch
} from './mission-worktree-ownership-marker'
import { localMissionWorktreeTarget } from './local-mission-worktree-target'

function ownershipCandidateKey(candidate: MissionOwnedWorktree): string {
  const parsed = splitWorktreeId(candidate.worktreeId)
  const pathKey = parsed
    ? `${parsed.repoId}\0${worktreePathComparisonKey(parsed.worktreePath)}`
    : candidate.worktreeId
  return `${pathKey}\0${candidate.worktreeInstanceId}`
}

export class MissionMemberOwnershipRecovery {
  constructor(
    private readonly store: Store,
    private readonly runtime: OrcaRuntimeService
  ) {}

  private async inspectOwnedWorktree(
    candidate: MissionOwnedWorktree,
    missionId: string,
    repoId: string,
    expectedBranch: string
  ): Promise<MissionOwnedWorktree | null> {
    const inspection = await this.runtime.inspectManagedWorktreeForOwnership(candidate.worktreeId)
    if (inspection.status === 'unavailable') {
      throw new Error('mission_member_worktree_liveness_unavailable')
    }
    if (inspection.status === 'missing') {
      return null
    }
    const worktree = inspection.worktree
    const branch = resolveMissionWorktreeBranch(worktree)
    const parsedCandidate = splitWorktreeId(candidate.worktreeId)
    if (
      parsedCandidate?.repoId !== repoId ||
      !areWorktreePathsEqual(parsedCandidate.worktreePath, worktree.path) ||
      worktree.repoId !== repoId ||
      worktree.instanceId !== candidate.worktreeInstanceId ||
      branch !== expectedBranch
    ) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    const repo = this.store.getRepo(repoId)
    if (!repo) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    assertMissionWorktreeOwnershipMarker({
      repoPath: repo.path,
      worktreePath: worktree.path,
      proof: {
        missionId,
        repoId,
        worktreeId: candidate.worktreeId,
        worktreeInstanceId: candidate.worktreeInstanceId
      }
    })
    return candidate
  }

  async recoverLiveOwnedWorktree(
    mission: Mission,
    repoId: string,
    slot: MissionSlot = 'member'
  ): Promise<MissionOwnedWorktree | null> {
    const expectedBranch = getMissionSlotBranch(mission, repoId, slot)
    if (!expectedBranch) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    const markerScan = await this.runtime.findManagedWorktreesForMissionOwnership(
      mission.id,
      repoId,
      expectedBranch,
      ...(slot === 'member' ? [] : [slot])
    )
    if (markerScan.status === 'unavailable') {
      throw new Error('mission_member_worktree_liveness_unavailable')
    }
    const markerCandidates = markerScan.candidates.map((proof) => ({
      worktreeId: proof.worktreeId,
      worktreeInstanceId: proof.worktreeInstanceId
    }))
    const liveByProof = new Map<string, MissionOwnedWorktree>()
    for (const markerCandidate of markerCandidates) {
      liveByProof.set(ownershipCandidateKey(markerCandidate), markerCandidate)
    }

    for (const candidate of findMissionOwnedWorktreeCandidates(
      this.store,
      mission.id,
      repoId,
      slot
    )) {
      const parsedCandidate = splitWorktreeId(candidate.worktreeId)
      const currentMarker = markerCandidates.find((markerCandidate) => {
        const parsedMarker = splitWorktreeId(markerCandidate.worktreeId)
        return (
          parsedCandidate?.repoId === repoId &&
          parsedMarker?.repoId === repoId &&
          areWorktreePathsEqual(parsedCandidate.worktreePath, parsedMarker.worktreePath)
        )
      })
      if (currentMarker) {
        if (currentMarker.worktreeInstanceId !== candidate.worktreeInstanceId) {
          // Why: the current Git row's marker supersedes a debounced stale
          // instance at the same path after external delete/recreate recovery.
          this.store.setWorktreeMeta(localMissionWorktreeTarget(candidate.worktreeId), {
            missionId: undefined
          })
        }
        continue
      }
      if (await this.inspectOwnedWorktree(candidate, mission.id, repoId, expectedBranch)) {
        liveByProof.set(ownershipCandidateKey(candidate), candidate)
      } else {
        // Why: a missing checkout must not retain ownership that a later
        // same-path non-Mission creation could accidentally inherit.
        this.store.setWorktreeMeta(localMissionWorktreeTarget(candidate.worktreeId), {
          missionId: undefined
        })
      }
    }
    const live = [...liveByProof.values()]
    if (live.length > 1) {
      throw new Error('mission_member_owned_worktree_ambiguous')
    }
    const recovered = live[0] ?? null
    if (recovered) {
      const record = getMissionSlotRecord(mission, repoId, slot)
      const parsedRecord = record?.worktreeId ? splitWorktreeId(record.worktreeId) : null
      const parsedRecovered = splitWorktreeId(recovered.worktreeId)
      const recordMatchesRecovered =
        parsedRecord?.repoId === repoId &&
        parsedRecovered?.repoId === repoId &&
        areWorktreePathsEqual(parsedRecord.worktreePath, parsedRecovered.worktreePath) &&
        record?.worktreeInstanceId === recovered.worktreeInstanceId
      if (
        (record?.worktreeId || record?.worktreeInstanceId) &&
        !recordMatchesRecovered &&
        !markerCandidates.some(
          (candidate) => ownershipCandidateKey(candidate) === ownershipCandidateKey(recovered)
        )
      ) {
        throw new Error('mission_member_worktree_ownership_unverified')
      }
      // Why: the Git-admin marker is published before debounced metadata; after
      // a crash it is the durable proof needed to restore the ownership stamp.
      this.store.setWorktreeMeta(localMissionWorktreeTarget(recovered.worktreeId), {
        missionId: mission.id,
        instanceId: recovered.worktreeInstanceId,
        missionSlot: slot === 'member' ? undefined : slot
      })
    }
    return recovered
  }

  async recoverMembersBeforeMissionDetach(mission: Mission): Promise<Mission> {
    for (const snapshotMember of mission.members) {
      const currentMission = this.store.getMission(mission.id)
      const currentMember = currentMission?.members.find(
        (member) => member.repoId === snapshotMember.repoId
      )
      if (!currentMission || !currentMember) {
        throw new Error('mission_member_not_found')
      }
      const recovered = await this.recoverLiveOwnedWorktree(currentMission, currentMember.repoId)
      if (
        recovered &&
        (currentMember.worktreeId !== recovered.worktreeId ||
          currentMember.worktreeInstanceId !== recovered.worktreeInstanceId)
      ) {
        this.store.setMissionMemberWorktree(
          currentMission.id,
          currentMember.repoId,
          recovered.worktreeId,
          recovered.worktreeInstanceId
        )
      }
      // Why: an intent-only task or preview checkout needs its marker before root cleanup too.
      for (const slot of getMissionRepoNonMemberSlots(currentMission, currentMember.repoId)) {
        await this.recoverLiveOwnedWorktree(currentMission, currentMember.repoId, slot)
      }
    }
    const orchestratorRepoId = mission.orchestratorRepoId
    if (orchestratorRepoId) {
      const currentMission = this.store.getMission(mission.id)
      if (!currentMission) {
        throw new Error('mission_not_found')
      }
      await this.recoverLiveOwnedWorktree(currentMission, orchestratorRepoId, 'orchestrator')
    }
    // Why: deleting while preserving checkouts may remove the root view next;
    // persist recovered pointers before that irreversible ordering boundary.
    await this.store.flushPendingOrThrowAsync()
    const recoveredMission = this.store.getMission(mission.id)
    if (!recoveredMission) {
      throw new Error('mission_not_found')
    }
    return recoveredMission
  }

  clearStrictlyMissingMemberPointer(mission: Mission, member: MissionMember): Promise<void> {
    return this.clearStrictlyMissingSlotPointer(mission, 'member', member)
  }

  async clearStrictlyMissingSlotPointer(
    mission: Mission,
    slot: MissionSlot,
    record: MissionSlotRecord
  ): Promise<void> {
    if (!record.worktreeId) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    const inspection = await this.runtime.inspectManagedWorktreeForOwnership(record.worktreeId)
    if (inspection.status === 'unavailable') {
      throw new Error('mission_member_worktree_liveness_unavailable')
    }
    if (inspection.status === 'found') {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    // Why: generic/external deletion can remove checkout metadata before the
    // Mission pointer; only a strict missing result permits clearing it.
    writeMissionSlotPointer(this.store, mission.id, record.repoId, slot, null, null)
  }
}
