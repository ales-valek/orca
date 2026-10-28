import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import { makeFakeRuntime, makeFakeStore, makeFakeWindow } from './missions-ipc-test-harness'

const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    }
  },
  BrowserWindow: class {}
}))

import { registerMissionHandlers } from './missions'
import { MissionOperations } from '../missions/mission-operations'

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

function register(): void {
  const store = makeFakeStore()
  registerMissionHandlers(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers only notify through webContents.send.
    makeFakeWindow() as never,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake store implements every Store method the mission handlers call.
    store as never,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake runtime implements every runtime method MissionOperations calls.
    makeFakeRuntime(store) as never
  )
}

function invoke(channel: string, args: unknown): Promise<unknown> {
  return Promise.resolve(handlers.get(channel)!({}, args))
}

describe('missions stack IPC', () => {
  beforeEach(() => {
    handlers.clear()
    vi.restoreAllMocks()
  })

  it('rejects a task without a title before reaching the operation', async () => {
    const addTask = vi.spyOn(MissionOperations.prototype, 'addTask')
    register()
    await expect(
      invoke('missions:addTask', { missionId: 'm1', repoId: 'r1', title: '' })
    ).rejects.toThrow('invalid_mission_add_task_args')
    expect(addTask).not.toHaveBeenCalled()
  })

  it('always deletes the removed top task worktree', async () => {
    const removeTopTask = vi
      .spyOn(MissionOperations.prototype, 'removeTopTask')
      .mockResolvedValue({ mission, task: null })
    register()
    await invoke('missions:removeTask', {
      missionId: 'm1',
      repoId: 'r1',
      taskId: 't2',
      deleteWorktree: false
    })
    expect(removeTopTask).toHaveBeenCalledWith({
      missionId: 'm1',
      repoId: 'r1',
      taskId: 't2',
      deleteWorktree: true
    })
  })

  it('forwards absorb overrides keyed by file and line', async () => {
    const absorb = vi
      .spyOn(MissionOperations.prototype, 'absorb')
      .mockResolvedValue({ applied: 1, ambiguous: [] })
    register()
    await invoke('missions:absorb', {
      missionId: 'm1',
      repoId: 'r1',
      overrides: { 'src/a.ts:3': 't1' }
    })
    expect(absorb).toHaveBeenCalledWith({
      missionId: 'm1',
      repoId: 'r1',
      overrides: { 'src/a.ts:3': 't1' }
    })
  })

  it('returns no stack reports for an unknown mission', async () => {
    register()
    await expect(invoke('missions:inspectStacks', { missionId: 'missing' })).resolves.toEqual([])
  })
})
