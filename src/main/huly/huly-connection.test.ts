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
let createFailsWithAuth = false

function createConnection(store = createHulyCredentialStore(directory)): HulyConnection {
  return new HulyConnection({
    store,
    createApi: async (_info, token) => {
      createdWith.push(token)
      if (createFailsWithAuth) {
        throw new Error('ERROR: platform:status:TokenExpired {}')
      }
      return api
    }
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-huly-connection-'))
  api = new FakeHulyApi()
  createdWith = []
  createFailsWithAuth = false
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

  it('maps an expired token on lazy reconnect to huly_auth_required', async () => {
    vi.useFakeTimers()
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })
    await vi.advanceTimersByTimeAsync(60_000)
    createFailsWithAuth = true

    await expect(connection.withApi((client) => client.listProjects())).rejects.toThrow(
      'huly_auth_required'
    )
    expect(connection.getStatus()).toEqual({ connected: true, info: INFO })
  })

  it('accepts https and loopback http server URLs only', async () => {
    const connection = createConnection()

    await expect(
      connection.connect({ serverUrl: 'http://huly.example.test', workspace: 'acme', token: TOKEN })
    ).rejects.toThrow('huly_server_url_must_be_https')
    expect(createdWith).toEqual([])
    await expect(
      connection.connect({ serverUrl: 'http://localhost:8087', workspace: 'acme', token: TOKEN })
    ).resolves.toMatchObject({ connected: true })
  })

  it('closes the validated client when saving the credentials fails', async () => {
    const store = createHulyCredentialStore(directory)
    const connection = createConnection({
      ...store,
      save: () => {
        throw new Error('disk full')
      }
    })

    await expect(connection.connect({ ...INFO, token: TOKEN })).rejects.toThrow('disk full')
    expect(api.closed).toBe(true)
    expect(connection.getStatus()).toEqual({ connected: false })
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

  it('redacts the submitted token from a failed connect', async () => {
    const connection = new HulyConnection({
      store: createHulyCredentialStore(directory),
      createApi: async () => {
        throw new Error(
          `socket failed for wss://huly.example.test/_transactor/${TOKEN}?x=1 (${TOKEN})`
        )
      }
    })

    const failure = await connection.connect({ ...INFO, token: ` ${TOKEN} ` }).catch((e) => e)

    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).not.toContain(TOKEN)
    expect(failure.message).toContain('_transactor/<redacted>')
    expect(String(failure.stack)).not.toContain(TOKEN)
  })

  it('redacts a transactor URL token from a failed call', async () => {
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })
    api.listProjects = async () => {
      throw new Error(`closed wss://huly.example.test/_transactor/${TOKEN}`)
    }

    await expect(connection.withApi((client) => client.listProjects())).rejects.toThrow(
      'closed wss://huly.example.test/_transactor/<redacted>'
    )
  })

  it('redacts the last path segment of any WebSocket URL in a failed call', async () => {
    const connection = createConnection()
    await connection.connect({ ...INFO, token: TOKEN })
    api.listProjects = async () => {
      throw new Error(`closed ws://10.0.0.5:3333/socket/${TOKEN}?v=2 and wss://h.test/a/${TOKEN}`)
    }

    await expect(connection.withApi((client) => client.listProjects())).rejects.toThrow(
      'closed ws://10.0.0.5:3333/socket/<redacted>?v=2 and wss://h.test/a/<redacted>'
    )
  })
})
