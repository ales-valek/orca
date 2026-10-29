import path from 'node:path'
import { vi } from 'vitest'
import type { MissionSlot } from '../../shared/mission-types'
import type { FakeStore } from './missions-ipc-test-contracts'

export const wtR1Path = path.join(path.sep, 'wt', 'r1')
export const wtR2Path = path.join(path.sep, 'wt', 'r2')

export function worktreePathForRepo(repoId: string): string {
  return repoId === 'r1' ? wtR1Path : wtR2Path
}

export function worktreeIdForRepo(repoId: string): string {
  return `${repoId}::${worktreePathForRepo(repoId)}`
}

export function instanceIdForRepo(repoId: string): string {
  return `instance-${repoId}`
}

export function ownershipProofForRepo(repoId: string) {
  return {
    missionId: 'm1',
    repoId,
    worktreeId: worktreeIdForRepo(repoId),
    worktreeInstanceId: instanceIdForRepo(repoId)
  }
}

type CreateWorktreeArgs = {
  repoSelector: string
  branchNameOverride: string
  missionId: string
  missionSlot?: MissionSlot
  worktreePathOverride?: string
}

export function createStampedWorktree(store: FakeStore, args: CreateWorktreeArgs) {
  const repoId = args.repoSelector.slice('id:'.length)
  const slot = args.missionSlot ?? 'member'
  // Why: member creates keep the fixed per-repo ids older assertions pin; other slots need their own.
  const worktreePath =
    slot === 'member' || !args.worktreePathOverride
      ? worktreePathForRepo(repoId)
      : args.worktreePathOverride
  const id = `${repoId}::${worktreePath}`
  const instanceId = slot === 'member' ? instanceIdForRepo(repoId) : `instance-${id}`
  store.setWorktreeMeta(id, {
    instanceId,
    missionId: args.missionId,
    ...(slot === 'member' ? {} : { missionSlot: slot })
  })
  return {
    worktree: { id, path: worktreePath, repoId, branch: args.branchNameOverride, instanceId }
  }
}

export function makeFakeRuntime(store: FakeStore) {
  const createdBranches = new Map<string, string>()
  return {
    createManagedWorktree: vi.fn(async (args: CreateWorktreeArgs) => {
      const created = createStampedWorktree(store, args)
      createdBranches.set(created.worktree.id, args.branchNameOverride)
      return created
    }),
    inspectManagedWorktreeForOwnership: vi.fn(async (id: string): Promise<unknown> => {
      const meta = store.getWorktreeMeta(id)
      if (!meta?.instanceId) {
        return { status: 'missing' as const }
      }
      return {
        status: 'found' as const,
        worktree: {
          id,
          path: id.slice(id.indexOf('::') + 2),
          repoId: id.split('::', 1)[0],
          branch:
            createdBranches.get(id) ?? store.getMissions()[0]?.branchName ?? 'mission/referral',
          instanceId: meta.instanceId
        }
      }
    }),
    findManagedWorktreesForMissionOwnership: vi.fn(
      async (): Promise<
        | {
            status: 'found'
            candidates: ReturnType<typeof ownershipProofForRepo>[]
          }
        | {
            status: 'unavailable'
          }
      > => ({ status: 'found', candidates: [] })
    ),
    removeManagedWorktree: vi.fn(async (_selector: string, _options?: unknown) => ({})),
    teardownWorkspaceProcesses: vi.fn(async () => {}),
    attachMissionOperations: vi.fn((_operations: unknown) => {})
  }
}
