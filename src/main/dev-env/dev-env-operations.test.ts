import { writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import {
  DEV_ENV_MASK,
  type DevEnv,
  type DevEnvServiceState,
  type DevEnvTemplate
} from '../../shared/dev-env/dev-env-types'
import type { Mission } from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import { composeWorktreeId } from '../../shared/worktree/id'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { DevEnvHostProxy } from './dev-env-host-proxy'
import type { DevEnvInfra } from './dev-env-infra'
import { DevEnvOperations, type DevEnvStore } from './dev-env-operations'
import type { DevEnvServices } from './dev-env-services'
import type { DevEnvSecretStore } from './dev-env-secret-store'
import type { DevEnvSetupPipeline } from './dev-env-setup-pipeline'

const ESHOP_MEMBER = composeWorktreeId('repo-eshop', '/m/eshop')
const ESHOP_PREVIEW = composeWorktreeId('repo-eshop', '/m/eshop--preview')
const ADMIN_MEMBER = composeWorktreeId('repo-admin', '/m/admin')
const STANDALONE = composeWorktreeId('repo-eshop', '/w/eshop-fix')
const REMOTE = composeWorktreeId('repo-remote', '/r/x')

const TEMPLATE: DevEnvTemplate = {
  id: 't1',
  name: 'OrderMage',
  dependencies: [],
  credentials: [{ label: 'Operator', userKey: 'secret.op-user', passwordKey: 'secret.op-pass' }],
  slots: [
    {
      name: 'eshop',
      repoId: 'repo-eshop',
      install: [],
      envFiles: [],
      services: [{ name: 'eshop', command: 'dev', portOffset: 50, dependsOn: ['admin-api'] }]
    },
    {
      name: 'admin',
      repoId: 'repo-admin',
      install: [],
      envFiles: [],
      services: [
        {
          name: 'admin-api',
          command: 'api',
          portOffset: 10,
          dependsOn: [],
          exports: { JWT: '${secret.jwt}' }
        }
      ]
    }
  ]
}

const SETTINGS: DevEnvGlobalSettings = {
  devEnvInfra: [],
  devEnvRemoteTiers: [
    {
      id: 'prod',
      name: 'Prod',
      danger: true,
      dependencies: { 'admin-api': { url: 'https://api.admin.prod.example', values: {} } }
    }
  ],
  devEnvTemplates: [TEMPLATE],
  devEnvProxyPort: 80,
  devEnvTools: []
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    name: 'Kiosek',
    branchName: 'mission/kiosek',
    members: [
      { repoId: 'repo-eshop', worktreeId: ESHOP_MEMBER, addedAt: 1 },
      { repoId: 'repo-admin', worktreeId: ADMIN_MEMBER, addedAt: 1 }
    ],
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

/** Test doubles that implement only what the code under test calls. */
function fake<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers pass every member the code under test reads.
  return value as T
}

function meta(displayName: string): WorktreeMeta {
  return fake<WorktreeMeta>({ displayName })
}

describe('DevEnvOperations', () => {
  let envs: DevEnv[]
  let missions: Mission[]
  let worktreeMeta: Record<string, WorktreeMeta>
  let repos: Record<string, Repo>
  let services: {
    getStates: ReturnType<typeof vi.fn>
    markMoved: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    forget: ReturnType<typeof vi.fn>
  }
  let pipeline: {
    run: ReturnType<typeof vi.fn>
    isRunning: ReturnType<typeof vi.fn>
    renderEnvFiles: ReturnType<typeof vi.fn>
    getLogPath: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }
  let operations: DevEnvOperations
  let settings: DevEnvGlobalSettings
  let infraCalls: string[]
  let restoreGate: Promise<void>
  let publishedRoutes: Map<string, unknown[]>

  beforeEach(() => {
    envs = []
    settings = SETTINGS
    infraCalls = []
    restoreGate = Promise.resolve()
    publishedRoutes = new Map()
    missions = [makeMission()]
    worktreeMeta = {
      [ESHOP_MEMBER]: meta('mission/kiosek'),
      [ESHOP_PREVIEW]: meta('mission-preview/kiosek'),
      [ADMIN_MEMBER]: meta('mission/kiosek'),
      [STANDALONE]: meta('fix/OMP-3011'),
      [REMOTE]: meta('remote')
    }
    repos = { 'repo-remote': fake<Repo>({ id: 'repo-remote', connectionId: 'ssh-1' }) }
    const store: DevEnvStore = {
      getDevEnvs: () => envs,
      getDevEnv: (id) => envs.find((env) => env.id === id) ?? null,
      createDevEnv: (env) => {
        envs.push(env)
        return env
      },
      updateDevEnv: (id, updates) => {
        const index = envs.findIndex((env) => env.id === id)
        if (index === -1) {
          return null
        }
        envs[index] = { ...envs[index], ...updates }
        return envs[index]
      },
      deleteDevEnv: (id) => {
        const before = envs.length
        envs = envs.filter((env) => env.id !== id)
        return envs.length !== before
      },
      getMission: (id) => missions.find((mission) => mission.id === id) ?? null,
      getMissions: () => missions,
      getWorktreeMeta: (id) => worktreeMeta[id],
      getRepo: (id) => repos[id]
    }
    services = {
      getStates: vi.fn(async (): Promise<DevEnvServiceState[]> => []),
      markMoved: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      start: vi.fn(async () => ({ started: [], errors: [] })),
      forget: vi.fn()
    }
    pipeline = {
      run: vi.fn(async () => {}),
      isRunning: vi.fn(() => false),
      renderEnvFiles: vi.fn(async () => []),
      getLogPath: vi.fn(() => '/tmp/log'),
      cancel: vi.fn()
    }
    const secrets = new Map([
      ['op-user', 'operator@stand.local'],
      ['op-pass', 'hunter2'],
      ['jwt', 'jwt-secret']
    ])
    operations = new DevEnvOperations({
      store,
      getSettings: () => settings,
      userDataDir: '/tmp/orca-test',
      terminals: {
        create: async () => ({ handle: 'h' }),
        isAlive: async () => ({ alive: false, exitCode: null }),
        close: async () => {}
      },
      notify: () => {},
      components: {
        services: fake<DevEnvServices>(services),
        pipeline: fake<DevEnvSetupPipeline>(pipeline),
        proxy: fake<DevEnvHostProxy>({
          setRoutes: async (ownerId: string, routes: unknown[]) => {
            publishedRoutes.set(ownerId, routes)
            return { ok: true }
          },
          clearRoutes: () => {},
          close: async () => {}
        }),
        secrets: fake<DevEnvSecretStore>({ getAll: () => secrets }),
        isPortFree: async () => true,
        worktreeExists: () => true,
        infra: fake<DevEnvInfra>({
          execToFile: async (service: string, _shell: string, path: string) => {
            infraCalls.push(`dump ${service}`)
            writeFileSync(path, 'rows')
            return { ok: true, code: 0 }
          },
          execFromFile: async (service: string) => {
            await restoreGate
            infraCalls.push(`restore ${service}`)
            return { ok: true, code: 0 }
          }
        })
      }
    })
  })

  it('creates a mission env bound to member worktrees, with a port slot and setup started', async () => {
    const env = await operations.createForMission('m1', 't1')
    expect(env).toMatchObject({
      key: 'kiosek',
      portSlot: 1,
      attachment: { kind: 'mission', missionId: 'm1' }
    })
    expect(env.slotWorktrees.eshop?.worktreeId).toBe(ESHOP_MEMBER)
    expect(pipeline.run).toHaveBeenCalledWith(env.id, {})
  })

  it('refuses a second env for the same mission', async () => {
    await operations.createForMission('m1', 't1')
    await expect(operations.createForMission('m1', 't1')).rejects.toThrow(
      'Kiosek already has a Dev Environment'
    )
  })

  it('refuses a remote repo worktree', async () => {
    await expect(operations.createForWorktree(REMOTE, 't1')).rejects.toThrow(
      'Dev Environments support local repos only'
    )
  })

  it('moves a slot when its preview appears, stops its services and re-runs env+install for that slot', async () => {
    const env = await operations.createForMission('m1', 't1')
    pipeline.run.mockClear()
    missions = [makeMission({ previews: [{ repoId: 'repo-eshop', worktreeId: ESHOP_PREVIEW }] })]
    await operations.reconcileMissions()
    expect(services.markMoved).toHaveBeenCalledWith(
      expect.objectContaining({ id: env.id }),
      TEMPLATE,
      ['eshop']
    )
    expect(pipeline.run).toHaveBeenCalledWith(env.id, {
      steps: ['env', 'install'],
      slots: ['eshop']
    })
    expect(envs[0].slotWorktrees.eshop?.worktreeId).toBe(ESHOP_PREVIEW)
  })

  it('detaches the env when its mission is deleted and keeps the record', async () => {
    const env = await operations.createForMission('m1', 't1')
    missions = []
    await operations.reconcileMissions()
    expect(envs).toHaveLength(1)
    expect(envs[0].detached).toBe(true)
    expect(services.stop).toHaveBeenCalledWith(env.id, 'all')
    expect((await operations.list())[0].attachmentLabel).toBe('Mission deleted')
  })

  it('reports a stopped paired provider as down and a deleted one as missing', async () => {
    const provider = await operations.createForMission('m1', 't1')
    const fix = await operations.createForWorktree(STANDALONE, 't1', { 'admin-api': provider.id })
    services.getStates.mockImplementation(async (env: DevEnv) =>
      env.id === provider.id
        ? [{ name: 'admin-api', slot: 'admin', status: 'stopped', port: 20110, url: null }]
        : []
    )
    expect((await operations.show(fix.id)).dependencyStates['admin-api']).toBe('down')
    envs = envs.filter((env) => env.id !== provider.id)
    expect((await operations.show(fix.id)).dependencyStates['admin-api']).toBe('missing')
  })

  it('never returns unmasked secrets from show or getEnvFiles', async () => {
    const env = await operations.createForMission('m1', 't1')
    pipeline.renderEnvFiles.mockResolvedValue([
      {
        slot: 'admin',
        path: '.env',
        text: 'JWT=jwt-secret',
        values: [
          { key: 'JWT', value: 'jwt-secret', section: 'SECRET', sources: ['secret'], secret: true }
        ]
      }
    ])
    const detail = await operations.show(env.id)
    expect(detail.credentials).toEqual([
      { label: 'Operator', user: 'operator@stand.local', password: DEV_ENV_MASK }
    ])
    const files = await operations.getEnvFiles(env.id)
    expect(JSON.stringify(files)).not.toContain('jwt-secret')
    expect(files[0].values[0].value).toBe(DEV_ENV_MASK)
    expect(operations.revealCredentialPassword(env.id, 'Operator')).toBe('hunter2')
  })

  it('queues moved slots while setup is running and runs them afterwards', async () => {
    const env = await operations.createForMission('m1', 't1')
    let finish: () => void = () => {}
    pipeline.isRunning.mockReturnValue(true)
    operations.startSetup(env.id, { steps: ['env', 'install'], slots: ['eshop'] })
    expect(pipeline.run).toHaveBeenCalledTimes(1)
    pipeline.isRunning.mockReturnValue(false)
    pipeline.run.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    operations.startSetup(env.id, {})
    finish()
    await vi.waitFor(() =>
      expect(pipeline.run).toHaveBeenLastCalledWith(env.id, {
        steps: ['env', 'install'],
        slots: ['eshop']
      })
    )
  })

  it('queues requests without slots while setup runs and merges them', async () => {
    const env = await operations.createForMission('m1', 't1')
    let finish: () => void = () => {}
    pipeline.isRunning.mockReturnValue(false)
    pipeline.run.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    operations.startSetup(env.id, { steps: ['install'] })
    pipeline.isRunning.mockReturnValue(true)
    operations.startSetup(env.id, { steps: ['env'] })
    operations.startSetup(env.id, { steps: ['seed'], withSeed: true })
    pipeline.isRunning.mockReturnValue(false)
    finish()
    await vi.waitFor(() =>
      expect(pipeline.run).toHaveBeenLastCalledWith(env.id, {
        steps: ['env', 'seed'],
        withSeed: true
      })
    )
  })

  it('creates an env for a worktree that has no meta, labelled by its folder name', async () => {
    const mainCheckout = composeWorktreeId('repo-admin', '/repos/admin')
    const env = await operations.createForWorktree(mainCheckout, 't1')
    expect(env.slotWorktrees.admin).toEqual({
      worktreeId: mainCheckout,
      path: '/repos/admin',
      label: 'admin · admin'
    })
  })

  it('restores hostname routes and reconciles after an Orca restart', async () => {
    const kept = await operations.createForMission('m1', 't1')
    const orphan = {
      ...kept,
      id: 'e-orphan',
      key: 'gone',
      attachment: { kind: 'mission' as const, missionId: 'm-gone' }
    }
    envs.push(orphan)
    publishedRoutes.clear()
    await operations.restore()
    expect([...publishedRoutes.keys()]).toEqual([kept.id])
    expect(envs.find((env) => env.id === 'e-orphan')?.detached).toBe(true)
  })

  it('binds a danger tier only with the environment key typed, and badges it', async () => {
    const env = await operations.createForWorktree(STANDALONE, 't1')
    expect(() => operations.bindRemote(env.id, 'admin-api', 'prod', 'nope')).toThrow(
      'Type the environment key to bind it to Prod'
    )
    expect(() => operations.bindRemote(env.id, 'admin-api', 'gone', env.key)).toThrow(
      'Unknown remote tier gone'
    )
    operations.bindRemote(env.id, 'admin-api', 'prod', env.key)
    expect(envs.find((entry) => entry.id === env.id)?.bindings['admin-api']).toEqual({
      kind: 'remote',
      tierId: 'prod'
    })
    const detail = await operations.show(env.id)
    expect(detail.badge.danger).toBe(true)
    expect(detail.remoteTiers['admin-api']).toEqual({ tierId: 'prod', name: 'Prod', danger: true })
    expect(detail.dependencyStates['admin-api']).toBe('remote')
  })

  it('snapshots dumpable infra, and restores with services stopped then the up ones restarted', async () => {
    settings = {
      ...SETTINGS,
      devEnvInfra: [
        {
          name: 'postgres',
          ports: [],
          environment: {},
          volumes: [],
          resource: { create: 'c', drop: 'd', dump: 'pg_dump', restore: 'pg_restore' }
        }
      ],
      devEnvTemplates: [
        {
          ...TEMPLATE,
          slots: TEMPLATE.slots.map((slot) => ({
            ...slot,
            services: slot.services.map((service) => ({ ...service, dependsOn: ['postgres'] }))
          }))
        }
      ]
    }
    const env = await operations.createForWorktree(STANDALONE, 't1')
    await expect(operations.snapshot(env.id, '../x')).rejects.toThrow('Snapshot name')
    const snapshot = await operations.snapshot(env.id, 'before-import')
    expect(snapshot).toMatchObject({ name: 'before-import', sizeBytes: 4, services: ['postgres'] })
    expect((await operations.show(env.id)).snapshots.map((entry) => entry.name)).toEqual([
      'before-import'
    ])

    services.getStates.mockResolvedValue([
      { name: 'eshop', status: 'up' },
      { name: 'admin-api', status: 'stopped' }
    ])
    services.stop.mockImplementation(async () => {
      infraCalls.push('stop')
    })
    services.start.mockImplementation(async (_env, _template, names) => {
      infraCalls.push(`start ${String(names)}`)
      return { started: [], errors: [] }
    })
    infraCalls = []
    await operations.restoreSnapshot(env.id, 'before-import')
    expect(infraCalls).toEqual(['stop', 'restore postgres', 'start eshop'])

    let finishRestore = (): void => {}
    services.start.mockClear()
    restoreGate = new Promise<void>((resolve) => {
      finishRestore = resolve
    })
    const restoring = operations.restoreSnapshot(env.id, 'before-import')
    await vi.waitFor(() => expect(infraCalls.at(-1)).toBe('stop'))
    await expect(operations.up(env.id)).rejects.toThrow('A restore of this environment is running')
    operations.bind(env.id, 'admin-api', null)
    expect(pipeline.run).toHaveBeenCalledTimes(1)
    finishRestore()
    await restoring
    expect(pipeline.run).toHaveBeenCalledTimes(2)

    await operations.deleteSnapshot(env.id, 'before-import')
    expect((await operations.show(env.id)).snapshots).toEqual([])
  })

  it('stops the services before switching to prod-build mode', async () => {
    const env = await operations.createForWorktree(STANDALONE, 't1')
    await operations.setMode(env.id, 'prod')
    expect(services.stop).toHaveBeenCalledWith(env.id, 'all')
    expect((await operations.show(env.id)).mode).toBe('prod')
  })
})
