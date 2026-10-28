import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeSocket = {
  readyState: number
  send: () => void
  close: () => void
  onerror?: (event: unknown) => void
}

// Resolve through api-client so the test exercises the exact (patched) copy it loads.
function loadClientResources(): { connect: (...args: unknown[]) => { close(): Promise<void> } } {
  const requireFromTest = createRequire(import.meta.url)
  const requireFromApiClient = createRequire(requireFromTest.resolve('@hcengineering/api-client'))
  return requireFromApiClient('@hcengineering/client-resources')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('patched @hcengineering/client-resources', () => {
  it('redacts the workspace token from websocket error logs', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sockets: FakeSocket[] = []
    const { connect } = loadClientResources()

    const connection = connect(
      'wss://huly.test/_transactor/secret-workspace-token',
      () => {},
      'workspace',
      'user',
      {
        socketFactory: () => {
          const socket: FakeSocket = { readyState: 0, send: () => {}, close: () => {} }
          sockets.push(socket)
          return socket
        }
      }
    )
    sockets[0]?.onerror?.({ type: 'error' })
    await connection.close()

    const logged = JSON.stringify(errors.mock.calls)
    expect(logged).toContain('wss://huly.test/_transactor/<redacted>')
    expect(logged).not.toContain('secret-workspace-token')
  })
})
