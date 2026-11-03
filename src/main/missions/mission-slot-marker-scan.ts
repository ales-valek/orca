import type { MissionSlot } from '../../shared/mission-types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { areWorktreePathsEqual } from '../git/worktrees/catalog/worktree-path-comparison'
import {
  readMissionWorktreeOwnershipMarker,
  resolveMissionWorktreeBranch,
  type MissionWorktreeOwnershipProof
} from './mission-worktree-ownership-marker'

/** Git-admin ownership proofs of one Mission slot in a repo's strict worktree scan. */
export function collectMissionSlotOwnershipProofs(args: {
  missionId: string
  repoId: string
  repoPath: string
  branchName: string
  slot: MissionSlot
  worktrees: GitWorktreeInfo[]
}): MissionWorktreeOwnershipProof[] {
  const proofs: MissionWorktreeOwnershipProof[] = []
  for (const worktree of args.worktrees) {
    if (worktree.isMainWorktree || worktree.isBare) {
      continue
    }
    const proof = readMissionWorktreeOwnershipMarker({
      repoPath: args.repoPath,
      worktreePath: worktree.path
    })
    if (!proof || proof.missionId !== args.missionId) {
      continue
    }
    if (proof.repoId !== args.repoId) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    // Why: each slot has its own branch; another slot's marker is verified by its own scan.
    if ((proof.missionSlot ?? 'member') !== args.slot) {
      continue
    }
    const parsedProofId = splitWorktreeIdForFilesystem(proof.worktreeId)
    if (
      parsedProofId?.repoId !== args.repoId ||
      !parsedProofId.worktreePath ||
      !areWorktreePathsEqual(parsedProofId.worktreePath, worktree.path) ||
      resolveMissionWorktreeBranch(worktree) !== args.branchName
    ) {
      throw new Error('mission_member_worktree_ownership_unverified')
    }
    proofs.push(proof)
  }
  return proofs
}
