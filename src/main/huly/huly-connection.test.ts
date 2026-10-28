import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { FakeHulyApi } from './fake-huly-api'
import { HulyConnection } from './huly-connection'
import { createHulyCredentialStore } from './huly-credential-store'

const INFO = { serverUrl: 'https://huly.example.test', workspace: 'acme' }
const TOKEN = 'huly-secret-token-123'

let directory = ''
let api: FakeHulyApi
let createdWith: string[] = []

function createConnection(): HulyConnection {
  return new HulyConnection({
    store: createHulyCredentialStore(directory),
    createApi: async (_info, token) => {
      createdWith.push(token)
      return api
    }
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-huly-connection-'))
  api = new FakeHulyApi()
  createdWith = []
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${Buffer.from(value).toString('base64')}`),
    decryptString: (value) =>
      Buffer.from(value.toString('utf-8').slice('enc:'.length), 'base64').toString('utf-8'),
    describeProtectionGap: () => null
  })
})

afterEach(() => {
  vi.useRealTimers()
  _resetSecretStoreForTests()
  rmSync(directory, { recursive: true, force: true })
})

describe('HulyConnection', () => {
  it('persists the connection after the token lists projects', async () => {
    const connection = createConnection()

    await expect(connection.connect({ ...INFO, token: TOKEN })).resolves.toEqual({
      connected: true,
      info: INFO
    })

    const reloaded = createConnection()
    expect(reloaded.getStatus()).toEqual({ connected: true, info: INFO })
    await expect(reloaded.withApi((client) => client.listProjects())).resolves.toEqual(api.projects)
    expect(createdWith).toEqual([TOKEN, TOKEN])
  })

  it('rejects an unauthorized token and persists nothing', async () => {
    api.failWithAuth = true
    const connection = createConnection()

    await expect(connection.connect({ ...INFO, token: TOKEN })).rejects.toThrow(
      'huly_auth_required'
    )
    expect(connection.getStatus()).toEqual({ connected: false })
    expect(readdirSync(directory)).toEqual([])
    expect(api.closed).toBe(true)
  })

  it('keeps the connection when the token is revoked mid-session', async () => {
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })
    api.failWithAuth = true

    await expect(connection.withApi((client) => client.listStatuses('OMP'))).rejects.toThrow(
      'huly_auth_required'
    )
    expect(connection.getStatus()).toEqual({ connected: true, info: INFO })
  })

  it('never exposes or stores the token in plaintext', async () => {
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })

    expect(JSON.stringify(connection.getStatus())).not.toContain(TOKEN)
    for (const name of readdirSync(directory)) {
      expect(readFileSync(join(directory, name), 'utf-8')).not.toContain(TOKEN)
    }
  })

  it('closes the client after a minute idle and reconnects on the next call', async () => {
    vi.useFakeTimers()
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })
    await connection.withApi((client) => client.listProjects())

    await vi.advanceTimersByTimeAsync(59_000)
    expect(api.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(api.closed).toBe(true)

    await connection.withApi((client) => client.listProjects())
    expect(createdWith).toEqual([TOKEN, TOKEN])
  })

  it('forgets the credentials on disconnect', async () => {
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })

    await connection.disconnect()

    expect(connection.getStatus()).toEqual({ connected: false })
    expect(existsSync(join(directory, 'huly-token.enc'))).toBe(false)
    await expect(connection.withApi((client) => client.listProjects())).rejects.toThrow(
      'huly_not_connected'
    )
  })
})
