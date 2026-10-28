import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock, removeHandler: vi.fn() } }))

import { registerHulyHandlers } from './register-handlers'

type Handler = (event: unknown, args?: unknown) => Promise<unknown>

function getRegisteredHandlers(runtime: Partial<OrcaRuntimeService>): Map<string, Handler> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only reach the huly commands this fake implements.
  registerHulyHandlers(runtime as OrcaRuntimeService)
  return new Map(handleMock.mock.calls.map(([channel, handler]) => [channel, handler]))
}

describe('registerHulyHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
  })

  it('connects through the runtime command with the trimmed fields', async () => {
    const hulyConnect = vi.fn(async () => ({
      connected: true as const,
      info: { serverUrl: 'https://huly.example', workspace: 'acme' }
    }))
    const handlers = getRegisteredHandlers({ hulyConnect })

    await handlers.get('huly:connect')!(
      {},
      { serverUrl: ' https://huly.example ', workspace: ' acme ', token: ' secret ' }
    )

    expect(hulyConnect).toHaveBeenCalledWith({
      serverUrl: 'https://huly.example',
      workspace: 'acme',
      token: 'secret'
    })
  })

  it('rejects a call with missing params before reaching Huly', async () => {
    const hulyListStatuses = vi.fn()
    const handlers = getRegisteredHandlers({ hulyListStatuses })

    await expect(handlers.get('huly:listStatuses')!({}, {})).rejects.toThrow()
    expect(hulyListStatuses).not.toHaveBeenCalled()
  })

  it('serves every Huly RPC method and the Mission import over IPC', () => {
    const handlers = getRegisteredHandlers({})

    expect([...handlers.keys()].sort()).toEqual([
      'huly:connect',
      'huly:createMission',
      'huly:disconnect',
      'huly:getMilestonePlan',
      'huly:listComponents',
      'huly:listMilestones',
      'huly:listProjects',
      'huly:listStatuses',
      'huly:refreshMission',
      'huly:status'
    ])
  })
})
