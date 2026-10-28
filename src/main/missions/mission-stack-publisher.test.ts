import { describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import type { Store } from '../persistence'
import { MissionStackPublisher } from './mission-stack-publisher'

vi.mock('./mission-repo-eligibility', () => ({
  requireNativeLocalMissionRepos: (_store: unknown, repoIds: string[]) => {
    if (repoIds.includes('remote')) {
      throw new Error('mission_native_local_only')
    }
  }
}))

function createPublisher(mission: Mission | null) {
  const store = {
    getMission: () => mission,
    getRepo: (id: string) => (id === 'r1' ? { id, path: '/repo' } : undefined)
  }
  const lifecycle = { run: <T>(_id: string, fn: () => Promise<T>) => fn() }
  // SAFETY: the publisher only calls getMission/getRepo on the store and run on the lifecycle.
  return new MissionStackPublisher(store as unknown as Store, lifecycle)
}

const mission: Mission = {
  id: 'm1',
  name: 'M',
  branchName: 'mission/m',
  members: [
    { repoId: 'r1', worktreeId: null, addedAt: 0 },
    { repoId: 'remote', worktreeId: 'remote::/wt', addedAt: 0 }
  ],
  tabOrder: 0,
  createdAt: 0,
  updatedAt: 0
}

describe('MissionStackPublisher', () => {
  it.each([
    ['unknown mission', null, 'r1', 'mission_not_found'],
    ['unknown member', mission, 'other', 'mission_member_not_found'],
    ['non-local repo', mission, 'remote', 'mission_native_local_only'],
    ['member without a worktree', mission, 'r1', 'mission_member_worktree_missing']
  ])('returns an error result for %s instead of throwing', async (_name, input, repoId, error) => {
    const publisher = createPublisher(input)

    await expect(publisher.createStackPullRequests({ missionId: 'm1', repoId })).resolves.toEqual({
      created: [],
      skipped: [],
      error
    })
    await expect(publisher.pushStack({ missionId: 'm1', repoId })).resolves.toEqual({
      pushed: [],
      error
    })
  })
})
