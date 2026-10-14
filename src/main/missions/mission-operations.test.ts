import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assignOwnedWorktree,
  getSetupHookMocks,
  makeFakeRuntime,
  makeFakeStore,
  makeFakeWindow,
  referralRootPath
} from '../ipc/missions-ipc-test-harness'

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

import { registerMissionHandlers } from '../ipc/missions'
import { MissionOperations } from './mission-operations'

const setupHookMocks = getSetupHookMocks()

type FakeStore = ReturnType<typeof makeFakeStore>

function createOperations(
  store: FakeStore,
  runtime: ReturnType<typeof makeFakeRuntime>,
  notifyChanged: () => void = vi.fn(),
  runSetupHook?: ConstructorParameters<typeof MissionOperations>[3]
): MissionOperations {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the shared Mission IPC fakes implement every store/runtime method these operations call.
  return new MissionOperations(store as never, runtime as never, notifyChanged, runSetupHook)
}

describe('MissionOperations', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  it('runs the setup hook after the Mission root and member worktrees exist', async () => {
    const store = makeFakeStore()
    const runtime = makeFakeRuntime(store)
    const notifyChanged = vi.fn()
    const operations = createOperations(store, runtime, notifyChanged)

    const result = await operations.create({ name: 'Referral', repoIds: ['r1', 'r1'] })

    expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledTimes(1)
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', rootPath: referralRootPath }),
      'create'
    )
    expect(runtime.createManagedWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      setupHookMocks.runMissionSetupHook.mock.invocationCallOrder[0]
    )
    expect(notifyChanged).toHaveBeenCalledTimes(2)
    expect(result.mission.rootPath).toBe(referralRootPath)
  })

  it('never fails Mission creation because the setup hook rejects', async () => {
    const store = makeFakeStore()
    const runtime = makeFakeRuntime(store)
    const runSetupHook = vi.fn(async () => {
      throw new Error('hook exploded')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const operations = createOperations(store, runtime, vi.fn(), runSetupHook)

    await expect(operations.create({ name: 'Referral', repoIds: ['r1'] })).resolves.toMatchObject({
      mission: { id: 'm1' }
    })
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
    consoleError.mockRestore()
  })

  it('runs the setup hook with members-added only when new repos joined', async () => {
    const store = makeFakeStore()
    store.createMission({ name: 'Referral', repoIds: ['r1'] })
    assignOwnedWorktree(store, 'r1')
    store.setMissionRootPath('m1', referralRootPath)
    const runtime = makeFakeRuntime(store)
    const operations = createOperations(store, runtime)

    await operations.addMembers({ missionId: 'm1', repoIds: ['r1'] })
    expect(setupHookMocks.runMissionSetupHook).not.toHaveBeenCalled()

    await operations.addMembers({ missionId: 'm1', repoIds: ['r1', 'r2'] })
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledTimes(1)
    expect(setupHookMocks.runMissionSetupHook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'm1',
        members: expect.arrayContaining([expect.objectContaining({ repoId: 'r2' })])
      }),
      'members-added'
    )
  })

  it('is shared with the runtime so `orca mission` RPC reuses IPC locks and notifications', async () => {
    const store = makeFakeStore()
    const runtime = makeFakeRuntime(store)
    const window = makeFakeWindow()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: same partial Electron/store/runtime fakes the Mission IPC suite registers with.
    registerMissionHandlers(window as never, store as never, runtime as never)

    expect(runtime.attachMissionOperations).toHaveBeenCalledTimes(1)
    const [operations] = runtime.attachMissionOperations.mock.calls[0]
    if (!(operations instanceof MissionOperations)) {
      throw new Error('expected MissionOperations')
    }

    await operations.create({ name: 'Referral', repoIds: ['r1'] })

    expect(window.webContents.send).toHaveBeenCalledWith('repos:changed')
    expect(handlers.get('missions:list')!({})).toEqual([expect.objectContaining({ id: 'm1' })])
  })
})
