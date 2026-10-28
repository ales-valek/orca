import type { HulyConnectionInfo, HulyConnectionStatus } from '../../shared/huly/huly-types'
import { createHulyApi, isHulyAuthError, type HulyApi } from './huly-api'
import { createHulyCredentialStore, type HulyCredentialStore } from './huly-credential-store'

const IDLE_CLOSE_MS = 60_000

type HulyConnectionDeps = {
  createApi?: typeof createHulyApi
  store?: HulyCredentialStore
}

export class HulyConnection {
  private readonly createApi: typeof createHulyApi
  private readonly store: HulyCredentialStore
  private status: HulyConnectionStatus | null = null
  private api: Promise<HulyApi> | null = null
  private activeRuns = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: HulyConnectionDeps = {}) {
    this.createApi = deps.createApi ?? createHulyApi
    this.store = deps.store ?? createHulyCredentialStore()
  }

  async connect(args: HulyConnectionInfo & { token: string }): Promise<HulyConnectionStatus> {
    const info = {
      serverUrl: args.serverUrl.trim().replace(/\/+$/, ''),
      workspace: args.workspace.trim()
    }
    assertSecureServerUrl(info.serverUrl)
    let api: HulyApi | null = null
    try {
      api = await this.createApi(info, args.token)
      await api.listProjects()
      this.store.save(info, args.token)
    } catch (error) {
      await api?.close().catch(() => {})
      throw redactHulyToken(toHulyError(error), [args.token, args.token.trim()])
    }
    await this.dropApi()
    this.status = { connected: true, info }
    this.api = Promise.resolve(api)
    this.scheduleIdleClose()
    return this.status
  }

  async disconnect(): Promise<void> {
    await this.dropApi()
    this.store.clear()
    this.status = { connected: false }
  }

  getStatus(): HulyConnectionStatus {
    if (this.status === null) {
      const info = this.store.readInfo()
      this.status = info && this.store.hasToken() ? { connected: true, info } : { connected: false }
    }
    return this.status
  }

  async withApi<T>(run: (api: HulyApi) => Promise<T>): Promise<T> {
    this.activeRuns += 1
    this.clearIdleTimer()
    try {
      return await run(await this.acquireApi())
    } catch (error) {
      if (isHulyAuthError(error)) {
        // Keep the saved connection so the UI can offer to reconnect.
        await this.dropApi()
      }
      throw redactHulyToken(toHulyError(error), [])
    } finally {
      this.activeRuns -= 1
      this.scheduleIdleClose()
    }
  }

  private acquireApi(): Promise<HulyApi> {
    if (this.api === null) {
      const info = this.store.readInfo()
      const token = this.store.readToken()
      if (!info || !token) {
        return Promise.reject(new Error('huly_not_connected'))
      }
      const pending = this.createApi(info, token)
      this.api = pending
      pending.catch(() => {
        if (this.api === pending) {
          this.api = null
        }
      })
    }
    return this.api
  }

  private async dropApi(): Promise<void> {
    this.clearIdleTimer()
    const api = this.api
    this.api = null
    await api?.then((client) => client.close()).catch(() => {})
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer()
    if (this.api === null || this.activeRuns > 0) {
      return
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.activeRuns === 0) {
        void this.dropApi()
      }
    }, IDLE_CLOSE_MS)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])

// The token travels in the WebSocket URL, so plain http is only acceptable on loopback.
function assertSecureServerUrl(serverUrl: string): void {
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    throw new Error('huly_server_url_must_be_https')
  }
  const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error('huly_server_url_must_be_https')
  }
}

function toHulyError(error: unknown): unknown {
  return isHulyAuthError(error) ? new Error('huly_auth_required') : error
}

const TRANSACTOR_TOKEN_SEGMENT = /(_transactor\/)[^/\s'"?#]+/g
const REDACTED = '<redacted>'

// Third-party client errors can embed the WebSocket URL, and the token is its last path segment.
function redactHulyToken(error: unknown, tokens: readonly string[]): unknown {
  const message = error instanceof Error ? error.message : String(error)
  let redacted = message.replace(TRANSACTOR_TOKEN_SEGMENT, `$1${REDACTED}`)
  for (const token of tokens) {
    if (token) {
      redacted = redacted.split(token).join(REDACTED)
    }
  }
  if (redacted === message && error instanceof Error) {
    return error
  }
  // A fresh Error so neither the stack nor a cause carries the original text.
  return new Error(redacted)
}
