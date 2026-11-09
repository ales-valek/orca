import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { MissionSlot } from '../../shared/mission-types'
import { resolveMissionManagedWorktreeCreate } from './runtime-mission-worktree-create'
import type { RuntimeManagedWorktreeCreateArgs } from './workspaces/creation/runtime-managed-worktree-create-types'
import type { RuntimeStore } from './construction/runtime-store-contract'

const repo: Repo = {
  id: 'r1',
  path: '/repos/r1',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 1
}

function resolve(request: Partial<RuntimeManagedWorktreeCreateArgs>) {
  return resolveMissionManagedWorktreeCreate({
    request: { repoSelector: 'id:r1', name: 'seed', ...request },
    repo,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every guarded request is rejected before the store is read.
    store: {} as RuntimeStore
  })
}

describe('resolveMissionManagedWorktreeCreate slot guard', () => {
  it('rejects a slot that is not a Mission slot', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates an untrusted RPC payload that bypassed static typing.
    const missionSlot = 'task:' as MissionSlot
    expect(() => resolve({ missionId: 'm1', missionSlot })).toThrow(
      'Mission slot requires a valid slot and its Mission.'
    )
  })

  it('rejects a slot without its Mission', () => {
    expect(() => resolve({ missionSlot: 'preview' })).toThrow(
      'Mission slot requires a valid slot and its Mission.'
    )
  })

  it('rejects a non-member slot created outside the Mission root', () => {
    expect(() =>
      resolve({
        missionId: 'm1',
        missionSlot: 'task:t1',
        branchNameOverride: 'mission-task/x/t1',
        requireExactBranchName: true
      })
    ).toThrow('Mission slot worktrees must be created inside the Mission root.')
  })

  it('keeps a member slot outside the root valid', () => {
    expect(resolve({ missionId: 'm1', missionSlot: 'member' })).toMatchObject({
      missionWorktreePath: null,
      missionRootOwnership: null
    })
  })
})
