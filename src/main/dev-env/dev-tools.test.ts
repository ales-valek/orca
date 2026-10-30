import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import type { DevEnvInfraState } from '../../shared/dev-env/dev-env-types'
import type { DevTool } from '../../shared/dev-env/dev-tools-types'
import type { DevEnvInfra } from './dev-env-infra'
import { DevTools } from './dev-tools'

const TOOLS: DevTool[] = [
  { kind: 'adminer', name: 'db', label: 'Databáze', port: 19180, infraService: 'postgres' },
  { kind: 'redisinsight', name: 'redis', label: 'Redis', port: 19181, infraService: 'redis' },
  { kind: 'bullmq-dashboard', name: 'queues', label: 'Fronty', port: 19182, infraService: 'redis' },
  {
    kind: 'link',
    name: 'audit',
    label: 'Audit log',
    infraService: 'clickhouse',
    portName: 'http',
    path: '/play'
  },
  { kind: 'link', name: 'ghost', label: 'Ghost', infraService: 'nope', portName: 'ui' }
]

const SETTINGS: DevEnvGlobalSettings = {
  devEnvInfra: [
    {
      name: 'postgres',
      ports: [{ name: 'db', host: 19032, container: 5432 }],
      environment: {},
      volumes: []
    },
    {
      name: 'redis',
      ports: [{ name: 'redis', host: 19079, container: 6379 }],
      environment: {},
      command: ['redis-server', '--requirepass', 'top-secret'],
      volumes: []
    },
    {
      name: 'clickhouse',
      ports: [{ name: 'http', host: 19023, container: 8123 }],
      environment: {},
      volumes: []
    }
  ],
  devEnvRemoteTiers: [],
  devEnvTemplates: [],
  devEnvTools: TOOLS,
  devEnvProxyPort: 80
}

/** Test doubles that implement only what the code under test calls. */
function fake<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers pass every member the code under test reads.
  return value as T
}

describe('DevTools', () => {
  let dir: string
  let infraStates: DevEnvInfraState[] | { error: string }
  let toolStates: DevEnvInfraState[]
  let ensured: string[][]
  let ensureResult: { ok: true; started: string[] } | { ok: false; error: string }
  let scriptExistedAtEnsure: boolean

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-dev-tools-'))
    infraStates = [
      { name: 'postgres', status: 'running', ports: [19032] },
      { name: 'redis', status: 'running', ports: [19079] },
      { name: 'clickhouse', status: 'running', ports: [19023] }
    ]
    toolStates = []
    ensured = []
    ensureResult = { ok: true, started: [] }
    scriptExistedAtEnsure = false
    probeAnswers = [true]
    probed = []
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  let probeAnswers: boolean[]
  let probed: number[]

  function create(): DevTools {
    return new DevTools({
      readyTimeoutMs: 50,
      sleep: async () => {},
      probeHttp: async (port: number) => {
        probed.push(port)
        return probeAnswers.shift() ?? false
      },
      dir,
      getSettings: () => SETTINGS,
      infra: fake<DevEnvInfra>({ getStatus: async () => infraStates }),
      tools: {
        getStatus: async () => toolStates,
        ensure: async (names: string[]) => {
          ensured.push(names)
          scriptExistedAtEnsure = existsSync(join(dir, 'bullmq-dashboard', 'server.mjs'))
          return ensureResult
        },
        stop: async () => true
      }
    })
  }

  const view = async (name: string) => (await create().list()).find((entry) => entry.name === name)

  it('reports infra-stopped and refuses to start a tool whose infra service is down', async () => {
    infraStates = [{ name: 'postgres', status: 'stopped', ports: [19032] }]
    expect(await view('db')).toMatchObject({ state: 'infra-stopped', url: null })
    expect(await create().open('db')).toEqual({ error: 'Infra service postgres is not running' })
    expect(ensured).toEqual([])
  })

  it('reports a container tool that never ran as not-started with its Adminer URL', async () => {
    expect(await view('db')).toMatchObject({
      state: 'not-started',
      url: 'http://127.0.0.1:19180/?pgsql=postgres&username=postgres'
    })
  })

  it('opens a link tool at the infra host port and path', async () => {
    expect(await view('audit')).toMatchObject({
      state: 'running',
      url: 'http://127.0.0.1:19023/play'
    })
  })

  it('marks a tool whose infra service is not defined as unavailable', async () => {
    const ghost = await view('ghost')
    expect(ghost?.state).toBe('unavailable')
    expect(ghost?.detail).toContain('nope')
  })

  it('reports Docker errors on every tool', async () => {
    infraStates = { error: 'Docker is not running' }
    expect(await view('db')).toMatchObject({
      state: 'unavailable',
      detail: 'Docker is not running'
    })
  })

  it('writes the BullMQ dashboard script before starting it', async () => {
    expect(await create().open('queues')).toEqual({ url: 'http://127.0.0.1:19182' })
    expect(ensured).toEqual([['queues']])
    expect(scriptExistedAtEnsure).toBe(true)
  })

  it('opens a started tool only once it answers over HTTP', async () => {
    probeAnswers = [false, false, true]
    expect(await create().open('redis')).toEqual({ url: 'http://127.0.0.1:19181' })
    expect(probed).toEqual([19181, 19181, 19181])
  })

  it('reports a started tool that never answers', async () => {
    probeAnswers = []
    const result = await create().open('redis')
    expect(result).toEqual({ error: expect.stringContaining('did not answer on port 19181') })
  })

  it('passes a start error such as a held port through unchanged', async () => {
    ensureResult = { ok: false, error: 'Port 19180 is held by pid 7 node. Orca did not start db.' }
    expect(await create().open('db')).toEqual({ error: ensureResult.error })
  })

  it('never exposes infra passwords in tool views', async () => {
    expect(JSON.stringify(await create().list())).not.toContain('top-secret')
  })
})
