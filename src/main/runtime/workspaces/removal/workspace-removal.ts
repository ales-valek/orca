import type { LocalProjectWorktreeGitOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import { isStaleLocalWorktreeRegistration } from '../catalog/stale-worktree-registration-preflight'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import type { GitWorktreeInfo } from '../../../../shared/worktree/types'
import { RuntimeWorkspaceMetadata } from '../workspace-metadata'
import {
  resolveWorktreeRemovalMetadata,
  resolveWorktreeRemovalRepoOwner
} from '../../../workspaces/removal/worktree-removal-repo-owner'
import type { RemoveWorktreeResult } from '../../../../shared/worktree/create-types'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { admitManagedWorktreeRemoval } from '../workspace-removal-admission'
import { finishAcceptedWorktreeRemoval } from '../../../workspaces/removal/worktree-background-removal'
import type {
  RemoveManagedWorktreeOptions,
  RuntimeWorktreeRemovalTarget
} from '../catalog/runtime-worktree-selection'
import { withWorktreeSpan } from '../../../observability/instrumentation'
import {
  resolveWorktreeRemovalHome,
  resolveWorktreeRemovalRoute
} from '../../../workspaces/removal/worktree-removal-execution-host-route'
import { listWorktreesOnRemovalRoute } from './worktree-removal-route-listing'
import { authorizeUnregisteredWindowsRemoval } from '../../../git/worktrees/removal/windows-worktree-removal'
import { findRegisteredDeletableWorktree } from '../../../workspaces/removal/worktree-removal-safety'
import { removeRuntimeUnregisteredWorktree } from './runtime-unregistered-worktree-removal'
import { removeStaleLocalWorktreeRegistration } from '../../../workspaces/removal/local-worktree-removal-recovery'
import { cleanupUnusedWorktreePushTargetRemote } from '../../../ipc/worktree-remote'
import { removeRuntimeRegisteredLocalWorktree } from './runtime-registered-local-worktree-removal'
import { isFolderRepo } from '../../../shared/repo-kind'
import {
  assertScopedMissionWorktreeOwnership,
  guardGenericMissionWorktreeRemoval,
  teardownOwningMissionSession
} from '../runtime-mission-worktree-removal-guard'
import { removeOrphanOrFolderWorktree } from './workspace-registration-removal'
import {
  assertWslMoveWorkspaceWritable,
  isWslMoveSourceHost
} from '../../../persistence/moving-wsl-projects/wsl-move-scope-guard'

export abstract class OrcaRuntimeWithRemoveManagedWorktree extends RuntimeWorkspaceMetadata {
  abstract removeWorktreeMetadataAndHistory(
    store: RuntimeStore,
    worktreeId: string,
    hostId?: ExecutionHostId
  ): Promise<void>
  protected abstract resolveWorktreeRemovalTarget(
    worktreeSelector: string,
    requiredHostId?: ExecutionHostId
  ): Promise<RuntimeWorktreeRemovalTarget>
  protected abstract joinPendingWorktreeRemoval(
    worktreeId: string,
    options: RemoveManagedWorktreeOptions
  ): Promise<RemoveWorktreeResult> | undefined
  protected abstract purgeRemovedWorktree(
    store: RuntimeStore,
    worktreeId: string,
    repoId: string,
    removalHostId?: ExecutionHostId
  ): Promise<void>
  protected abstract retryFailedRemoval(
    route: { kind: string },
    target: { id: string; path: string },
    registeredWorktrees: readonly GitWorktreeInfo[],
    options: RemoveManagedWorktreeOptions,
    localOptions: LocalProjectWorktreeGitOptions
  ): Promise<boolean>

  async removeManagedWorktree(
    worktreeSelector: string,
    options: RemoveManagedWorktreeOptions = {}
  ): Promise<RemoveWorktreeResult & { warning?: string }> {
    const {
      force = false,
      runHooks = false,
      allowUnverifiedPtyStop = false,
      allowFailedArchiveHook = false,
      hostId,
      expectedOwnership
    } = options
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const store = this.store
    const cleanupHostId = parseExecutionHostId(hostId)?.id
    const removalTarget = await this.resolveWorktreeRemovalTarget(worktreeSelector, cleanupHostId)
    const admission = await admitManagedWorktreeRemoval({
      store,
      removalTarget,
      cleanupHostId,
      options,
      joinPending: (worktreeId, removalOptions) =>
        this.joinPendingWorktreeRemoval(worktreeId, removalOptions),
      getInFlight: (scopeKey, worktreeId, optionsKey) =>
        this.removeManagedWorktreeInFlight.get(scopeKey, worktreeId, optionsKey),
      emitLifecycle: (event) => this.emitWorktreeLifecycle(event)
    })
    if ('joined' in admission) {
      return admission.joined
    }
    const { emitRemoved } = admission
    const removal = (async (): Promise<RemoveWorktreeResult & { warning?: string }> => {
      return withWorktreeSpan({ stage: 'remove', path: removalTarget.path }, async () => {
        const repoOwner = resolveWorktreeRemovalRepoOwner(
          store,
          removalTarget.repoId,
          cleanupHostId
        )
        if (repoOwner.kind === 'ambiguous') {
          throw new Error(
            `Workspace identity is ambiguous across hosts: ${removalTarget.id}. Retry with an explicit host.`
          )
        }
        const repo = repoOwner.kind === 'resolved' ? repoOwner.repo : undefined
        if (expectedOwnership && (!repo || repo.connectionId || isFolderRepo(repo))) {
          throw new Error('mission_member_worktree_ownership_unverified')
        }
        if (!expectedOwnership) {
          await guardGenericMissionWorktreeRemoval({
            store,
            removalTarget,
            repo,
            stopSessionPtys: (workspaceId) =>
              this.stopPtysForDestructiveWorktreeRemoval(workspaceId)
          })
        }
        const removalHostId = repo ? (cleanupHostId ?? getRepoExecutionHostId(repo)) : cleanupHostId
        const purgeRemovedWorktree = (): Promise<void> =>
          this.purgeRemovedWorktree(store, removalTarget.id, removalTarget.repoId, removalHostId)
        const orphanOrFolderResult = await removeOrphanOrFolderWorktree({
          runtime: this,
          store,
          removalTarget,
          cleanupHostId,
          removalHostId,
          repo
        })
        if (orphanOrFolderResult) {
          return orphanOrFolderResult
        }
        // Use one host for list/prune/delete; executionHostId-only SSH rows must never fall back to this client. Missing/folder repos returned earlier.
        const route = resolveWorktreeRemovalRoute(removalHostId!)
        const { localWorktreeGitOptions, registeredWorktrees } = await listWorktreesOnRemovalRoute(
          route,
          repo!,
          this.requireStore()
        )
        const removedMeta = resolveWorktreeRemovalMetadata(
          store,
          removalTarget.repoId,
          removalTarget.id,
          removalHostId!
        )
        const removedPushTarget = removedMeta?.pushTarget ?? removalTarget.pushTarget
        const removalHome = resolveWorktreeRemovalHome(route)
        const registeredWorktree = findRegisteredDeletableWorktree(
          repo!.path,
          removalTarget.path,
          registeredWorktrees,
          removalHome
        )
        if (expectedOwnership && repo) {
          assertScopedMissionWorktreeOwnership({
            repo,
            registeredPath: registeredWorktree?.path,
            removedMeta,
            expectedOwnership,
            removalTarget
          })
          await teardownOwningMissionSession(store, expectedOwnership.missionId, (workspaceId) =>
            this.stopPtysForDestructiveWorktreeRemoval(workspaceId)
          )
        }
        await authorizeUnregisteredWindowsRemoval(
          !!registeredWorktree,
          repo!.path,
          removalTarget.path,
          force,
          localWorktreeGitOptions
        )
        if (
          await this.retryFailedRemoval(
            route,
            removalTarget,
            registeredWorktrees,
            options,
            localWorktreeGitOptions
          )
        ) {
          return { removing: true }
        }
        if (!registeredWorktree) {
          return removeRuntimeUnregisteredWorktree({
            repo: repo!,
            target: removalTarget,
            registeredWorktrees,
            removedMeta,
            removedPushTarget,
            force,
            allowUnverifiedPtyStop,
            route,
            localOptions: localWorktreeGitOptions,
            store,
            acquireWatcherRemoval: this.acquireFileWatcherRemoval,
            stopPtys: (worktreeId, allowUnverifiedPtyStop) =>
              this.stopPtysForDestructiveWorktreeRemoval(worktreeId, {
                allowUnverifiedStop: allowUnverifiedPtyStop
              }),
            finishRemoval: async () => {
              this.preservedBranchCleanup.delete(removalTarget.id, cleanupHostId)
              await purgeRemovedWorktree()
              this.notifyWorktreesChanged(repo!.id)
            }
          })
        }
        const canonicalWorktreePath = registeredWorktree.path
        const deleteBranch = options.deleteBranch ?? removedMeta?.preserveBranchOnDelete !== true
        if (
          await isStaleLocalWorktreeRegistration(
            registeredWorktree,
            force,
            removedMeta,
            localWorktreeGitOptions
          )
        ) {
          const removalResult = await removeStaleLocalWorktreeRegistration({
            canonicalWorktreePath,
            repoPath: repo!.path,
            localWorktreeGitOptions,
            registeredWorktree,
            deleteBranch
          })
          await cleanupUnusedWorktreePushTargetRemote(
            repo!.path,
            removalTarget.id,
            removedPushTarget,
            store,
            localWorktreeGitOptions
          )
          this.preservedBranchCleanup.remember(
            removalTarget.id,
            cleanupHostId,
            removalResult,
            registeredWorktree.head,
            removedPushTarget
          )
          await purgeRemovedWorktree()
          this.notifyWorktreesChanged(repo!.id)
          return removalResult ?? {}
        }
        return removeRuntimeRegisteredLocalWorktree({
          repo: repo!,
          target: removalTarget,
          registeredWorktree,
          removedPushTarget,
          store,
          localOptions: localWorktreeGitOptions,
          hasLocalOptions: Object.keys(localWorktreeGitOptions).length > 0,
          force,
          runHooks,
          allowFailedArchiveHook,
          allowUnverifiedPtyStop,
          deleteBranch,
          requestedDeleteBranch: options.deleteBranch,
          acquireWatcherRemoval: this.acquireFileWatcherRemoval,
          stopPtys: () =>
            this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id, {
              allowUnverifiedStop: allowUnverifiedPtyStop
            }),
          closeWatchers: (path) => this.closeFileWatchersForRemoval(path),
          preserveBranchHead: (result, fallbackHead) =>
            this.preservedBranchCleanup.preserveHead(result, fallbackHead),
          finishRemoval: async (result, rememberBranch, fallbackHead) => {
            if (rememberBranch) {
              this.preservedBranchCleanup.remember(
                removalTarget.id,
                cleanupHostId,
                result,
                fallbackHead,
                removedPushTarget
              )
            } else {
              this.preservedBranchCleanup.delete(removalTarget.id, cleanupHostId)
            }
            await purgeRemovedWorktree()
          },
          onRemoved: emitRemoved,
          publish: () => this.publishWorktreeRemovalChange(repo!.id)
        })
      })
    })()
    this.removeManagedWorktreeInFlight.track(cleanupScopeKey, optionsKey, removal)
    try {
      const accepted = await removal
      // A background removal emits this when Git finishes instead.
      if (!accepted.removing) {
        emitRemoved()
      }
      if (!options.waitForBackgroundRemoval) {
        return accepted
      }
      // oxlint-disable-next-line typescript/return-await -- the in-flight entry covers acceptance only, not the background wait
      return finishAcceptedWorktreeRemoval(accepted, removalTarget.id, cleanupHostId)
    } finally {
      this.removeManagedWorktreeInFlight.release(cleanupScopeKey, removal)
    }
  }
}
