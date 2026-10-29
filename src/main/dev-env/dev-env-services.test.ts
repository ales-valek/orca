import { beforeEach, describe, expect, it } from 'vitest'
import type { DevEnv, DevEnvServiceDef, DevEnvTemplate } from '../../shared/dev-env/dev-env-types'
import { DevEnvServices, orderDevEnvServices, type DevEnvTerminalPort } from './dev-env-services'

const SERVICE: DevEnvServiceDef = { name: 'x', command: 'run', portOffset: 0, dependsOn: [] }

const TEMPLATE: DevEnvTemplate = {
  id: 't1',
  name: 'T',
  dependencies: [],
  credentials: [],
  slots: [
    {
      name: 'admin',
      repoId: 'r-admin',
      install: [],
      envFiles: [],
      services: [
        {
          ...SERVICE,
          name: 'admin-api',
          command: 'nx serve backend --port ${self.admin-api.port}',
          portOffset: 10,
          dependsOn: ['postgres']
        },
        {
          ...SERVICE,
          name: 'admin-ui',
          portOffset: 20,
          dependsOn: ['admin-api'],
          ready: { httpPath: '/' }
        }
      ]
    },
    {
      name: 'eshop',
      repoId: 'r-eshop',
      install: [],
      envFiles: [],
      services: [{ ...SERVICE, name: 'eshop', portOffset: 50, dependsOn: ['admin-api'] }]
    },
    {
      name: 'cms',
      repoId: 'r-cms',
      install: [],
      envFiles: [],
      services: [{ ...SERVICE, name: 'cms-api', portOffset: 30 }]
    }
  ]
}

const ENV: DevEnv = {
  id: 'e1',
  key: 'kiosek',
  name: 'Kiosek',
  templateId: 't1',
  attachment: { kind: 'mission', missionId: 'm1' },
  portSlot: 1,
  slotPins: {},
  slotWorktrees: {
    admin: { worktreeId: 'w-admin', path: '/m/admin', label: 'admin · preview' },
    eshop: { worktreeId: 'w-eshop', path: '/m/eshop', label: 'eshop · preview' },
    cms: null
  },
  bindings: {},
  setup: {},
  createdAt: 1
}

describe('orderDevEnvServices', () => {
  it('orders services after their service dependencies and ignores infra names', () => {
    expect(
      orderDevEnvServices([
        { ...SERVICE, name: 'ui', dependsOn: ['api'] },
        { ...SERVICE, name: 'api', dependsOn: ['postgres'] },
        { ...SERVICE, name: 'worker', dependsOn: [] }
      ])
    ).toEqual(['api', 'ui', 'worker'])
  })

  it('reports a cycle with its path', () => {
    expect(
      orderDevEnvServices([
        { ...SERVICE, name: 'a', dependsOn: ['b'] },
        { ...SERVICE, name: 'b', dependsOn: ['a'] }
      ])
    ).toEqual({ error: 'Service dependency cycle: a → b → a' })
  })
})

describe('DevEnvServices', () => {
  let terminals: Map<
    string,
    {
      worktreeId: string
      title: string
      command: string
      cwd: string
      alive: boolean
      exitCode: number | null
    }
  >
  let listening: Set<number>
  let httpOk: Set<string>
  let services: DevEnvServices

  beforeEach(() => {
    terminals = new Map()
    listening = new Set()
    httpOk = new Set()
    let counter = 0
    const port: DevEnvTerminalPort = {
      create: async (worktreeId, opts) => {
        const handle = `term-${++counter}`
        terminals.set(handle, { worktreeId, ...opts, alive: true, exitCode: null })
        return { handle }
      },
      isAlive: async (handle) => {
        const terminal = terminals.get(handle)
        return terminal
          ? { alive: terminal.alive, exitCode: terminal.exitCode }
          : { alive: false, exitCode: null }
      },
      close: async (handle) => {
        terminals.delete(handle)
      },
      findByTitle: async (worktreeId, title) =>
        [...terminals.entries()].find(
          ([, t]) => t.worktreeId === worktreeId && t.title === title
        )?.[0] ?? null
    }
    services = new DevEnvServices({
      terminals: port,
      probePort: async (p) => listening.has(p),
      probeHttp: async (port, path) => httpOk.has(`http://127.0.0.1:${port}${path}`),
      notify: () => {},
      renderCommand: async (_env, _template, command) => ({
        command: command.replace('${self.admin-api.port}', '20110')
      }),
      sleep: async () => {
        // Why: each wait tick brings the services up so dependency waits finish.
        for (const p of [20110, 20120, 20150]) {
          listening.add(p)
        }
      },
      readyTimeoutMs: 50
    })
  })

  it('starts all services in dependency order in their worktrees, skipping unbound slots', async () => {
    const result = await services.start(ENV, TEMPLATE, 'all')
    expect(result.started).toEqual(['admin-api', 'admin-ui', 'eshop'])
    expect(result.errors).toEqual(['cms-api: slot cms has no worktree'])
    const created = [...terminals.values()]
    expect(created.map((t) => [t.title, t.worktreeId, t.cwd])).toEqual([
      ['Kiosek:admin-api', 'w-admin', '/m/admin'],
      ['Kiosek:admin-ui', 'w-admin', '/m/admin'],
      ['Kiosek:eshop', 'w-eshop', '/m/eshop']
    ])
    expect(created[0].command).toBe('nx serve backend --port 20110')
  })

  it('names a foreign port holder and does not start that service', async () => {
    const guarded = new DevEnvServices({
      terminals: {
        create: async (worktreeId, opts) => {
          terminals.set(opts.title, { worktreeId, ...opts, alive: true, exitCode: null })
          return { handle: opts.title }
        },
        isAlive: async () => ({ alive: false, exitCode: null }),
        close: async () => {}
      },
      probePort: async () => false,
      probeHttp: async () => false,
      notify: () => {},
      renderCommand: async (_env, _template, command) => ({ command }),
      findPortHolder: async (port) => (port === 20150 ? 'pid 42 node' : null)
    })
    const result = await guarded.start(ENV, TEMPLATE, ['eshop'])
    expect(result).toEqual({
      started: [],
      errors: ['eshop: port 20150 is held by pid 42 node. Orca did not start eshop.']
    })
    expect(terminals.size).toBe(0)
  })

  it('reports a command that cannot be rendered and does not start it', async () => {
    const failing = new DevEnvServices({
      terminals: {
        create: async () => ({ handle: 'never' }),
        isAlive: async () => ({ alive: false, exitCode: null }),
        close: async () => {}
      },
      probePort: async () => false,
      probeHttp: async () => false,
      notify: () => {},
      renderCommand: async () => ({ error: 'Unresolved ${dep.admin-api.url}' })
    })
    expect(await failing.start(ENV, TEMPLATE, ['eshop'])).toEqual({
      started: [],
      errors: ['eshop: Unresolved ${dep.admin-api.url}']
    })
  })

  it('does not start a service whose terminal is alive', async () => {
    await services.start(ENV, TEMPLATE, ['eshop'])
    const result = await services.start(ENV, TEMPLATE, ['eshop'])
    expect(result.started).toEqual([])
    expect(terminals.size).toBe(1)
  })

  it('derives the six statuses', async () => {
    await services.start(ENV, TEMPLATE, ['admin-api', 'admin-ui', 'eshop'])
    listening = new Set([20110, 20120])
    const [apiHandle, , eshopHandle] = [...terminals.keys()]
    terminals.get(eshopHandle)!.alive = false
    terminals.get(eshopHandle)!.exitCode = 1
    let states = await services.getStates(ENV, TEMPLATE, 80)
    const byName = (name: string) => states.find((s) => s.name === name)
    expect(byName('admin-api')).toMatchObject({
      status: 'up',
      port: 20110,
      url: 'http://127.0.0.1:20110',
      worktreeLabel: 'admin · preview'
    })
    expect(byName('admin-ui')).toMatchObject({ status: 'starting' })
    httpOk.add('http://127.0.0.1:20120/')
    states = await services.getStates(ENV, TEMPLATE, 80)
    expect(byName('admin-ui')?.status).toBe('up')
    expect(byName('eshop')).toMatchObject({ status: 'crashed', exitCode: 1 })
    expect(byName('cms-api')).toMatchObject({ status: 'unbound' })
    await services.markMoved(ENV, TEMPLATE, ['admin'])
    states = await services.getStates(ENV, TEMPLATE, 80)
    expect(states.find((s) => s.name === 'admin-api')?.status).toBe('moved')
    expect(terminals.has(apiHandle)).toBe(false)
    await services.stop(ENV.id, ['eshop'])
    states = await services.getStates(ENV, TEMPLATE, 80)
    expect(states.find((s) => s.name === 'eshop')?.status).toBe('stopped')
  })

  it('closes only the moved slot terminals', async () => {
    await services.start(ENV, TEMPLATE, ['admin-api', 'eshop'])
    await services.markMoved(ENV, TEMPLATE, ['eshop'])
    expect([...terminals.values()].map((t) => t.title)).toEqual(['Kiosek:admin-api'])
  })

  it('rediscovers running service terminals by title', async () => {
    await services.start(ENV, TEMPLATE, ['eshop'])
    listening.add(20150)
    const fresh = new DevEnvServices({
      terminals: {
        create: async () => ({ handle: 'new' }),
        isAlive: async (handle) => ({ alive: terminals.has(handle), exitCode: null }),
        close: async () => {},
        findByTitle: async (worktreeId, title) =>
          [...terminals.entries()].find(
            ([, t]) => t.worktreeId === worktreeId && t.title === title
          )?.[0] ?? null
      },
      probePort: async (p) => listening.has(p),
      probeHttp: async () => true,
      notify: () => {},
      renderCommand: async (_env, _template, command) => ({ command })
    })
    const states = await fresh.getStates(ENV, TEMPLATE, 80)
    expect(states.find((s) => s.name === 'eshop')?.status).toBe('up')
  })

  it('still starts dependents when a dependency is not up in time, and reports it', async () => {
    const slow = new DevEnvServices({
      terminals: {
        create: async (worktreeId, opts) => {
          terminals.set(opts.title, { worktreeId, ...opts, alive: true, exitCode: null })
          return { handle: opts.title }
        },
        isAlive: async () => ({ alive: true, exitCode: null }),
        close: async () => {}
      },
      probePort: async () => false,
      probeHttp: async () => false,
      notify: () => {},
      renderCommand: async (_env, _template, command) => ({ command }),
      sleep: async () => {},
      readyTimeoutMs: 0
    })
    const result = await slow.start(ENV, TEMPLATE, ['admin-api', 'admin-ui'])
    expect(result.started).toEqual(['admin-api', 'admin-ui'])
    expect(result.errors).toEqual(['admin-ui: admin-api was not up in time'])
  })
})
