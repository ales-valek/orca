import { describe, expect, it } from 'vitest'
import type { MissionMember } from '../../shared/mission-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import {
  findMissionOwnedWorktreeCandidates,
  getMissionOwnedWorktree
} from './mission-worktree-ownership'

const member: MissionMember = {
  repoId: 'r1',
  worktreeId: 'r1::/workspace',
  worktreeInstanceId: 'instance-1',
  addedAt: 1
}

function makeStore(metaById: Record<string, Partial<WorktreeMeta>>) {
  return {
    getWorktreeMeta: (id: string) => metaById[id],
    getAllWorktreeMeta: () => metaById
  }
}

describe('Mission worktree ownership', () => {
  it('requires repo, mission, and instance stamps to agree', () => {
    const owned = makeStore({
      'r1::/workspace': { missionId: 'm1', instanceId: 'instance-1' }
    })
    expect(getMissionOwnedWorktree(owned as never, { id: 'm1' }, member)).toEqual({
      worktreeId: 'r1::/workspace',
      worktreeInstanceId: 'instance-1'
    })

    for (const candidate of [
      { ...member, repoId: 'r2' },
      { ...member, worktreeInstanceId: 'reused-instance' },
      { ...member, worktreeInstanceId: null },
      { ...member, worktreeId: 'malformed' }
    ]) {
      expect(getMissionOwnedWorktree(owned as never, { id: 'm1' }, candidate)).toBeNull()
    }
    expect(getMissionOwnedWorktree(owned as never, { id: 'other' }, member)).toBeNull()
  })

  it('finds only candidates stamped for the same mission and repo', () => {
    const store = makeStore({
      'r1::/one': { missionId: 'm1', instanceId: 'i1' },
      'r1::/two': { missionId: 'm2', instanceId: 'i2' },
      'r2::/three': { missionId: 'm1', instanceId: 'i3' },
      malformed: { missionId: 'm1', instanceId: 'i4' },
      'r1::/missing-instance': { missionId: 'm1' }
    })
    expect(findMissionOwnedWorktreeCandidates(store as never, 'm1', 'r1')).toEqual([
      { worktreeId: 'r1::/one', worktreeInstanceId: 'i1' }
    ])
  })

  it('keys candidates by slot and counts meta without a slot as the member', () => {
    const store = makeStore({
      'r1::/legacy': { missionId: 'm1', instanceId: 'i1' },
      'r1::/preview': { missionId: 'm1', instanceId: 'i2', missionSlot: 'preview' },
      'r1::/task': { missionId: 'm1', instanceId: 'i3', missionSlot: 'task:t1' }
    })
    const legacy = [{ worktreeId: 'r1::/legacy', worktreeInstanceId: 'i1' }]
    expect(findMissionOwnedWorktreeCandidates(store as never, 'm1', 'r1')).toEqual(legacy)
    expect(findMissionOwnedWorktreeCandidates(store as never, 'm1', 'r1', 'member')).toEqual(legacy)
    expect(findMissionOwnedWorktreeCandidates(store as never, 'm1', 'r1', 'preview')).toEqual([
      { worktreeId: 'r1::/preview', worktreeInstanceId: 'i2' }
    ])
    expect(findMissionOwnedWorktreeCandidates(store as never, 'm1', 'r1', 'task:t2')).toEqual([])
  })
})
