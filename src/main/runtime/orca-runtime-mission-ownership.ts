import { OrcaRuntimeWithWindowlessTerminalActivity } from './orca-runtime-windowless-terminal-activity'
import { isFolderRepo } from '../../shared/repo-kind'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import type { Worktree } from '../../shared/worktree/types'
import { areWorktreePathsEqual } from '../ipc/worktree-path-comparison'
import { mergeWorktree } from '../ipc/worktree-logic'
import { listWorktreesStrict } from '../git/worktree'
import { resolveLocalProjectRuntimeForRepo } from '../local-project-runtime-resolution'
import { getLocalProjectWorktreeGitOptionsForRuntime } from '../project-runtime-git-options'
import { recoverMissionWorktreeCreateIntent } from '../missions/mission-worktree-create-intent'
import {
  readMissionWorktreeOwnershipMarker,
  resolveMissionWorktreeBranch,
  type MissionWorktreeOwnershipProof
} from '../missions/mission-worktree-ownership-marker'
import { withTimeoutResult } from './runtime-async-boundaries'
import { RESOLVED_WORKTREE_REPO_TIMEOUT_MS } from './repo-worktree-row-resolution'

export type ManagedWorktreeOwnershipInspection =
  | { status: 'found'; worktree: Worktree }
  | { status: 'missing' }
  | { status: 'unavailable' }

export type ManagedMissionOwnershipScan =
  | { status: 'found'; candidates: MissionWorktreeOwnershipProof[] }
  | { status: 'unavailable' }

export abstract class OrcaRuntimeWithMissionOwnership extends OrcaRuntimeWithWindowlessTerminalActivity {
  async teardownWorkspaceProcesses(workspaceId: string, connectionId?: string): Promise<void> {
    await this.stopPtysForDestructiveWorktreeRemoval(
      workspaceId,
      connectionId ? { connectionId } : {}
    )
  }

  async inspectManagedWorktreeForOwnership(
    worktreeId: string
  ): Promise<ManagedWorktreeOwnershipInspection> {
    const parsed = splitWorktreeIdForFilesystem(worktreeId)
    const repo = parsed ? this.store?.getRepo(parsed.repoId) : null
    if (!parsed?.worktreePath || !repo || repo.connectionId || isFolderRepo(repo)) {
      return { status: 'unavailable' }
    }
    const projectRuntime = resolveLocalProjectRuntimeForRepo(this.requireStore(), repo)
    // Why: ownership cleanup may erase durable Mission state; only the strict
    // Git scan can distinguish an absent checkout from a failed repository probe.
    const scan = await withTimeoutResult(
      listWorktreesStrict(
        repo.path,
        getLocalProjectWorktreeGitOptionsForRuntime(repo, projectRuntime)
      ),
      RESOLVED_WORKTREE_REPO_TIMEOUT_MS
    )
    if (!scan.ok) {
      return { status: 'unavailable' }
    }
    const gitWorktree = scan.value.find((candidate) =>
      areWorktreePathsEqual(candidate.path, parsed.worktreePath)
    )
    if (!gitWorktree) {
      return { status: 'missing' }
    }
    return {
      status: 'found',
      worktree: mergeWorktree(
        repo.id,
        gitWorktree,
        this.store?.getWorktreeMeta(worktreeId),
        repo.displayName
      )
    }
  }

  async findManagedWorktreesForMissionOwnership(
    missionId: string,
    repoId: string,
    branchName: string
  ): Promise<ManagedMissionOwnershipScan> {
    const repo = this.store?.getRepo(repoId)
    if (!repo || repo.connectionId || isFolderRepo(repo)) {
      return { status: 'unavailable' }
    }
    const projectRuntime = resolveLocalProjectRuntimeForRepo(this.requireStore(), repo)
    const scan = await withTimeoutResult(
      listWorktreesStrict(
        repo.path,
        getLocalProjectWorktreeGitOptionsForRuntime(repo, projectRuntime)
      ),
      RESOLVED_WORKTREE_REPO_TIMEOUT_MS
    )
    if (!scan.ok) {
      return { status: 'unavailable' }
    }
    const mission = this.store?.getMission?.(missionId)
    const recovered =
      mission?.rootPath && mission.rootBasePath
        ? recoverMissionWorktreeCreateIntent({
            root: {
              baseDir: mission.rootBasePath,
              rootPath: mission.rootPath,
              missionId: mission.id
            },
            repoId,
            repoPath: repo.path,
            branchName,
            worktrees: scan.value
          })
        : null
    const candidates: MissionWorktreeOwnershipProof[] = recovered ? [recovered] : []
    for (const worktree of scan.value) {
      if (worktree.isMainWorktree || worktree.isBare) {
        continue
      }
      const proof = readMissionWorktreeOwnershipMarker({
        repoPath: repo.path,
        worktreePath: worktree.path
      })
      if (!proof || proof.missionId !== missionId) {
        continue
      }
      if (proof.repoId !== repoId) {
        throw new Error('mission_member_worktree_ownership_unverified')
      }
      const parsedProofId = splitWorktreeIdForFilesystem(proof.worktreeId)
      if (
        parsedProofId?.repoId !== repoId ||
        !parsedProofId.worktreePath ||
        !areWorktreePathsEqual(parsedProofId.worktreePath, worktree.path) ||
        resolveMissionWorktreeBranch(worktree) !== branchName
      ) {
        throw new Error('mission_member_worktree_ownership_unverified')
      }
      if (
        !candidates.some(
          (candidate) =>
            candidate.worktreeId === proof.worktreeId &&
            candidate.worktreeInstanceId === proof.worktreeInstanceId
        )
      ) {
        candidates.push(proof)
      }
    }
    for (const proof of candidates) {
      // Why: the Git-admin marker outlives debounced metadata and also records
      // whether Mission creation reused a pre-existing local branch.
      this.store?.setWorktreeMeta(proof.worktreeId, {
        missionId,
        instanceId: proof.worktreeInstanceId,
        preserveBranchOnDelete: proof.preserveBranchOnDelete
      })
    }
    return { status: 'found', candidates }
  }
}
