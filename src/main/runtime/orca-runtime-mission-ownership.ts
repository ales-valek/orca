import { OrcaRuntimeWithWindowlessTerminalActivity } from './sidebar-inputs/orca-runtime-windowless-terminal-activity'
import { isFolderRepo } from '../../shared/repo-kind'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import type { Worktree } from '../../shared/worktree/types'
import { areWorktreePathsEqual } from '../git/worktrees/catalog/worktree-path-comparison'
import { mergeWorktree } from '../ipc/worktree-metadata-merge'
import { listWorktreesStrict } from '../git/worktrees/catalog/worktree-listing'
import { resolveLocalProjectRuntimeForRepo } from '../workspaces/execution-host/local-project-runtime-resolution'
import { getLocalProjectWorktreeGitOptionsForRuntime } from '../workspaces/execution-host/project-runtime-git-options'
import type { MissionSlot } from '../../shared/mission-types'
import { recoverMissionWorktreeCreateIntent } from '../missions/mission-worktree-create-intent'
import type { MissionWorktreeOwnershipProof } from '../missions/mission-worktree-ownership-marker'
import { collectMissionSlotOwnershipProofs } from '../missions/mission-slot-marker-scan'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { RESOLVED_WORKTREE_REPO_TIMEOUT_MS } from './workspaces/catalog/repo-worktree-row-resolution'
import { localMissionWorktreeTarget } from '../missions/local-mission-worktree-target'

function withTimeoutResult<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ ok: true; value: T } | { ok: false }> {
  return withTimeout(
    promise.then((value) => ({ ok: true, value }) as const),
    timeoutMs,
    { ok: false }
  )
}

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
    branchName: string,
    slot: MissionSlot = 'member'
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
            slot,
            repoPath: repo.path,
            branchName,
            worktrees: scan.value
          })
        : null
    const candidates: MissionWorktreeOwnershipProof[] = recovered ? [recovered] : []
    for (const proof of collectMissionSlotOwnershipProofs({
      missionId,
      repoId,
      repoPath: repo.path,
      branchName,
      slot,
      worktrees: scan.value
    })) {
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
      this.store?.setWorktreeMeta(localMissionWorktreeTarget(proof.worktreeId), {
        missionId,
        instanceId: proof.worktreeInstanceId,
        preserveBranchOnDelete: proof.preserveBranchOnDelete,
        missionSlot: proof.missionSlot
      })
    }
    return { status: 'found', candidates }
  }
}
