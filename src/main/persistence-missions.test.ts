import { closeTestStores, testState, createStore, writeDataFile } from './persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

vi.mock('./telemetry/client', () => ({
  track: trackMock
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

describe('missions persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates, updates, and deletes missions with member bookkeeping', () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [
        { id: 'r1', path: '/tmp/r1', displayName: 'R1', badgeColor: '#000', addedAt: 1 },
        { id: 'r2', path: '/tmp/r2', displayName: 'R2', badgeColor: '#000', addedAt: 1 }
      ],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} }
    })
    const store = createStore()

    const mission = store.createMission({ name: 'Referral', repoIds: ['r1', 'r2'] })
    expect(mission.branchName).toBe('mission/referral')
    expect(store.getMissions()).toHaveLength(1)
    expect(store.getMission(mission.id)?.members.map((member) => member.repoId)).toEqual([
      'r1',
      'r2'
    ])

    store.setMissionMemberWorktree(mission.id, 'r1', 'r1::/tmp/wt')
    expect(store.getMission(mission.id)?.members[0].worktreeId).toBe('r1::/tmp/wt')

    expect(store.updateMission(mission.id, { name: 'Referral v2' })?.name).toBe('Referral v2')
    expect(store.removeMissionMember(mission.id, 'r2')?.members).toHaveLength(1)
    expect(store.addMissionMembers(mission.id, ['r2', 'r2'])?.members).toHaveLength(2)

    expect(store.deleteMission(mission.id)).toBe(true)
    expect(store.getMissions()).toHaveLength(0)
    expect(store.deleteMission(mission.id)).toBe(false)
  })

  it('normalizes and sanitizes persisted missions on load', () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [{ id: 'r1', path: '/tmp/r1', displayName: 'R1', badgeColor: '#000', addedAt: 1 }],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      missions: [
        {
          id: 'm1',
          name: 'Keep',
          branchName: 'mission/keep',
          tabOrder: 0,
          members: [
            { repoId: 'r1', worktreeId: null, addedAt: 1 },
            { repoId: 'ghost', worktreeId: null, addedAt: 1 }
          ],
          createdAt: 1,
          updatedAt: 1
        },
        { id: 'm1', name: 'Duplicate' },
        'garbage'
      ]
    })

    const store = createStore()

    const missions = store.getMissions()
    expect(missions).toHaveLength(1)
    expect(missions[0].name).toBe('Keep')
    expect(missions[0].members).toEqual([{ repoId: 'r1', worktreeId: null, addedAt: 1 }])
  })
})
