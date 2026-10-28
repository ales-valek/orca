import {
  closeTestStores,
  testState,
  createStore,
  writeDataFile
} from './persistence/persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join, sep } from 'node:path'
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
        {
          id: 'r1',
          path: join(sep, 'tmp', 'r1'),
          displayName: 'R1',
          badgeColor: '#000',
          addedAt: 1
        },
        {
          id: 'r2',
          path: join(sep, 'tmp', 'r2'),
          displayName: 'R2',
          badgeColor: '#000',
          addedAt: 1
        }
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
      repos: [
        {
          id: 'r1',
          path: join(sep, 'tmp', 'r1'),
          displayName: 'R1',
          badgeColor: '#000',
          addedAt: 1
        }
      ],
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
    expect(missions[0].members).toEqual([
      { repoId: 'r1', worktreeId: null, worktreeInstanceId: null, lastError: null, addedAt: 1 }
    ])
  })
})

describe('mission slot persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  function createSlotStore() {
    writeDataFile({
      schemaVersion: 1,
      repos: ['r1', 'r2'].map((id) => ({
        id,
        path: join(sep, 'tmp', id),
        displayName: id,
        badgeColor: '#000',
        addedAt: 1
      })),
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} }
    })
    const store = createStore()
    return { store, mission: store.createMission({ name: 'Referral', repoIds: ['r1', 'r2'] }) }
  }

  it('stacks tasks per repo and only removes the top layer', () => {
    const { store, mission } = createSlotStore()
    const first = store.addMissionTask(mission.id, {
      repoId: 'r1',
      title: 'One',
      branchName: 'mission-task/referral/one'
    })
    const second = store.addMissionTask(mission.id, {
      repoId: 'r1',
      title: 'Two',
      branchName: 'mission-task/referral/two'
    })
    const other = store.addMissionTask(mission.id, {
      repoId: 'r2',
      title: 'Other',
      branchName: 'mission-task/referral/other'
    })
    expect([first?.order, second?.order, other?.order]).toEqual([1, 2, 1])
    expect(
      store.addMissionTask(mission.id, { repoId: 'ghost', title: 'x', branchName: 'x' })
    ).toBeNull()

    expect(() => store.removeMissionTask(mission.id, first!.id)).toThrow('mission_task_not_top')
    expect(store.removeMissionTask(mission.id, second!.id)?.tasks).toHaveLength(2)
    expect(store.removeMissionTask(mission.id, first!.id)?.tasks).toHaveLength(1)
  })

  it('creates and removes preview and orchestrator slot entries', () => {
    const { store, mission } = createSlotStore()
    store.setMissionSlotWorktree(mission.id, 'r1', 'preview', 'r1::/p', 'i1')
    expect(store.getMission(mission.id)?.previews).toEqual([
      { repoId: 'r1', worktreeId: 'r1::/p', worktreeInstanceId: 'i1', lastError: null }
    ])
    store.setMissionSlotError(mission.id, 'r1', 'preview', 'boom')
    expect(store.getMission(mission.id)?.previews?.[0].lastError).toBe('boom')
    store.setMissionSlotWorktree(mission.id, 'r1', 'preview', null, null)
    expect(store.getMission(mission.id)?.previews).toEqual([])

    expect(store.setMissionSlotWorktree(mission.id, 'r1', 'orchestrator', 'r1::/o')).toBeNull()
    store.getMission(mission.id)!.orchestratorRepoId = 'r1'
    store.setMissionSlotWorktree(mission.id, 'r1', 'orchestrator', 'r1::/o', 'i2')
    expect(store.getMission(mission.id)?.orchestrator?.worktreeId).toBe('r1::/o')
    store.setMissionSlotWorktree(mission.id, 'r1', 'orchestrator', null, null)
    expect(store.getMission(mission.id)?.orchestrator).toBeNull()
  })

  it('routes task and member slots to their entries', () => {
    const { store, mission } = createSlotStore()
    const task = store.addMissionTask(mission.id, {
      repoId: 'r1',
      title: 'One',
      branchName: 'mission-task/referral/one'
    })!
    store.setMissionSlotWorktree(mission.id, 'r1', `task:${task.id}`, 'r1::/t', 'i3')
    store.setMissionSlotError(mission.id, 'r1', `task:${task.id}`, 'failed')
    expect(store.getMission(mission.id)?.tasks?.[0]).toMatchObject({
      worktreeId: 'r1::/t',
      worktreeInstanceId: 'i3',
      lastError: 'failed'
    })
    expect(store.setMissionSlotWorktree(mission.id, 'r2', `task:${task.id}`, 'x')).toBeNull()
    store.setMissionSlotWorktree(mission.id, 'r2', 'member', 'r2::/m', 'i4')
    expect(store.getMission(mission.id)?.members[1].worktreeId).toBe('r2::/m')
  })

  it('persists a task parent base sha across reload', async () => {
    const { store, mission } = createSlotStore()
    const task = store.addMissionTask(mission.id, {
      repoId: 'r1',
      title: 'One',
      branchName: 'mission-task/referral/one'
    })!
    store.setMissionTaskParentBaseSha(mission.id, task.id, 'abc123')
    store.flushOrThrow()
    const reloaded = createStore()
    expect(reloaded.getMission(mission.id)?.tasks?.[0].parentBaseSha).toBe('abc123')
  })

  it('persists a pending task base and the tip a preview followed across reload', async () => {
    const { store, mission } = createSlotStore()
    const task = store.addMissionTask(mission.id, {
      repoId: 'r1',
      title: 'One',
      branchName: 'mission-task/referral/one'
    })!
    store.setMissionSlotWorktree(mission.id, 'r1', 'preview', 'r1::/tmp/preview', 'instance')
    store.setMissionTaskPendingParentBaseSha(mission.id, task.id, 'def456')
    store.setMissionPreviewFollowedSha(mission.id, 'r1', 'abc123')
    store.flushOrThrow()
    const reloaded = createStore().getMission(mission.id)
    expect(reloaded?.tasks?.[0].pendingParentBaseSha).toBe('def456')
    expect(reloaded?.previews?.[0].followedSha).toBe('abc123')
  })
})

describe('mission session workspaces', () => {
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

  it('ensures, renames with the mission, and cleans up on mission delete', () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [
        {
          id: 'r1',
          path: join(sep, 'tmp', 'r1'),
          displayName: 'R1',
          badgeColor: '#000',
          addedAt: 1
        }
      ],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} }
    })
    const store = createStore()
    const mission = store.createMission({
      name: 'Referral',
      repoIds: ['r1'],
      sessionAgent: 'claude'
    })

    expect(() => store.ensureMissionSessionWorkspace(mission.id)).toThrow('mission_root_not_ready')
    store.setMissionRootPath(mission.id, join(sep, 'tmp', 'orca', 'missions', 'referral'))

    const workspace = store.ensureMissionSessionWorkspace(mission.id)
    expect(workspace.missionId).toBe(mission.id)
    expect(workspace.projectGroupId).toBe(`mission:${mission.id}`)
    expect(workspace.folderPath).toBe(join(sep, 'tmp', 'orca', 'missions', 'referral'))
    // Why: the persisted mission agent drives first-open auto-launch even when
    // the session is created on the lazy retry path.
    expect(workspace.createdWithAgent).toBe('claude')
    expect(store.ensureMissionSessionWorkspace(mission.id).id).toBe(workspace.id)
    expect(store.getMissionSessionWorkspace(mission.id)?.id).toBe(workspace.id)

    store.updateMission(mission.id, { name: 'Referral v2' })
    expect(store.getMissionSessionWorkspace(mission.id)?.name).toBe('Referral v2')

    store.deleteMission(mission.id)
    expect(store.getMissionSessionWorkspace(mission.id)).toBeNull()
    expect(store.getFolderWorkspaces()).toHaveLength(0)
  })

  it('runs the session in the orchestrator worktree while one is recorded', () => {
    writeDataFile({
      schemaVersion: 1,
      repos: ['r1', 'o1'].map((id) => ({
        id,
        path: join(sep, 'tmp', id),
        displayName: id,
        badgeColor: '#000',
        addedAt: 1
      })),
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} }
    })
    const store = createStore()
    const rootPath = join(sep, 'tmp', 'orca', 'missions', 'referral')
    const orchestratorPath = join(rootPath, 'o1-o1--orchestrator')
    const mission = store.createMission({
      name: 'Referral',
      repoIds: ['r1'],
      orchestratorRepoId: 'o1'
    })
    store.setMissionRootPath(mission.id, rootPath)
    expect(store.ensureMissionSessionWorkspace(mission.id).folderPath).toBe(rootPath)

    store.setMissionSlotWorktree(mission.id, 'o1', 'orchestrator', `o1::${orchestratorPath}`, 'i1')
    expect(store.ensureMissionSessionWorkspace(mission.id).folderPath).toBe(orchestratorPath)

    store.setMissionSlotWorktree(mission.id, 'o1', 'orchestrator', null, null)
    expect(store.ensureMissionSessionWorkspace(mission.id).folderPath).toBe(rootPath)
  })

  it('drops mission session workspaces whose mission disappeared on load', () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      missions: [],
      folderWorkspaces: [
        {
          id: 'fw-orphan',
          projectGroupId: 'mission:ghost',
          missionId: 'ghost',
          name: 'Ghost session',
          folderPath: join(sep, 'tmp', 'orca', 'missions', 'ghost')
        }
      ]
    })
    const store = createStore()
    expect(store.getFolderWorkspaces()).toHaveLength(0)
  })
})
