import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import type { DevEnv, DevEnvTemplate } from '../../shared/dev-env/dev-env-types'
import { isDevEnvFileGitIgnored } from './dev-env-git-ignore'
import { DevEnvSetupPipeline, type DevEnvSetupDeps } from './dev-env-setup-pipeline'
import type { DevEnvExec } from './dev-env-shell-command'

const TEMPLATE: DevEnvTemplate = {
  id: 't1',
  name: 'OrderMage',
  dependencies: [],
  credentials: [],
  seed: { slot: 'eshop', command: 'npm run seed', enabledByDefault: false },
  slots: [
    {
      name: 'eshop',
      repoId: 'repo-eshop',
      install: ['npm ci'],
      envFiles: [
        {
          path: '.env',
          base: '.env.example',
          lines: [
            { key: 'PORT', value: '${self.eshop.port}' },
            { key: 'REDIS_PORT', value: '${infra.redis.port}' }
          ]
        }
      ],
      services: [{ name: 'eshop', command: 'npm run dev', portOffset: 50, dependsOn: ['redis'] }]
    },
    {
      name: 'admin',
      repoId: 'repo-admin',
      install: ['npm ci', 'npm run build:libs'],
      envFiles: [
        { path: 'apps/backend/.env.local', lines: [{ key: 'DB_NAME', value: '${devEnv.key}' }] }
      ],
      services: [
        { name: 'admin-api', command: 'nx serve backend', portOffset: 10, dependsOn: ['postgres'] }
      ]
    },
    { name: 'cms', repoId: 'repo-cms', install: ['pnpm i'], envFiles: [], services: [] }
  ]
}

const SETTINGS: DevEnvGlobalSettings = {
  devEnvProxyPort: 80,
  devEnvTemplates: [TEMPLATE],
  devEnvRemoteTiers: [],
  devEnvInfra: [
    {
      name: 'postgres',
      ports: [{ name: 'db', host: 5432, container: 5432 }],
      environment: {},
      volumes: []
    },
    {
      name: 'redis',
      ports: [{ name: 'redis', host: 6379, container: 6379 }],
      environment: {},
      volumes: [],
      resource: { create: 'true', drop: 'true' }
    },
    { name: 'clickhouse', ports: [], environment: {}, volumes: [] }
  ]
}

describe('DevEnvSetupPipeline', () => {
  let root: string
  let env: DevEnv
  let execCalls: { args: string[]; cwd?: string }[]
  let execResult: (args: string[]) => number
  let ensured: string[][]
  let written: Map<string, string>
  let deps: DevEnvSetupDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-dev-env-setup-'))
    const eshopPath = join(root, 'eshop')
    const adminPath = join(root, 'admin')
    mkdirSync(eshopPath, { recursive: true })
    mkdirSync(join(adminPath, 'apps/backend'), { recursive: true })
    writeFileSync(join(eshopPath, '.env.example'), 'PORT=3000\nNAME=eshop\n')
    env = {
      id: 'e1',
      key: 'kiosek',
      name: 'Kiosek',
      templateId: 't1',
      attachment: { kind: 'mission', missionId: 'm1' },
      portSlot: 1,
      slotPins: {},
      slotWorktrees: {
        eshop: { worktreeId: 'w1', path: eshopPath, label: 'eshop · preview' },
        admin: { worktreeId: 'w2', path: adminPath, label: 'admin · mission branch' },
        cms: null
      },
      bindings: {},
      setup: {},
      createdAt: 1
    }
    execCalls = []
    execResult = () => 0
    ensured = []
    written = new Map()
    const exec: DevEnvExec = async (_program, args, opts) => {
      execCalls.push({ args, cwd: opts.cwd })
      return { code: execResult(args), stdout: '', stderr: '', timedOut: false }
    }
    deps = {
      store: {
        getDevEnv: (id) => (id === env.id ? env : null),
        getDevEnvs: () => [env],
        updateDevEnv: (id, updates) => {
          if (id !== env.id) {
            return null
          }
          env = { ...env, ...updates }
          return env
        }
      },
      getSettings: () => SETTINGS,
      infra: {
        ensure: async (names) => {
          ensured.push(names)
          return { ok: true, started: names }
        },
        exec: async () => ({ ok: true, code: 0 })
      },
      secrets: { getAll: () => new Map() },
      resolveDependencies: async () => new Map(),
      exec,
      logDir: (id) => join(root, 'logs', id),
      isGitIgnored: async () => true,
      notify: () => {},
      readFile: async (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
      writeFile: async (path, text) => {
        written.set(path, text)
        writeFileSync(path, text)
      }
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('runs steps in order and records done states', async () => {
    await new DevEnvSetupPipeline(deps).run('e1')
    expect(env.setup.ports).toMatchObject({ status: 'done', detail: '20100–20199' })
    expect(env.setup.env).toMatchObject({
      status: 'done',
      detail: '2 files in 2 repos; unbound: cms'
    })
    expect(env.setup.install?.status).toBe('done')
    expect(env.setup.infra).toMatchObject({ status: 'done', detail: 'started postgres, redis' })
    expect(env.setup.data).toMatchObject({ status: 'done', detail: 'redis' })
    expect(env.setup.seed).toMatchObject({ status: 'skipped', detail: 'off in template' })
    expect(readFileSync(join(root, 'eshop/.env'), 'utf8')).toContain(
      'PORT=20150\nREDIS_PORT=6379\n'
    )
    expect(ensured).toEqual([['postgres', 'redis']])
  })

  it('installs per bound slot in its worktree, in command order', async () => {
    await new DevEnvSetupPipeline(deps).run('e1', { steps: ['install'] })
    expect(execCalls.map((call) => [call.cwd, call.args.at(-1)])).toEqual([
      [join(root, 'eshop'), 'npm ci'],
      [join(root, 'admin'), 'npm ci'],
      [join(root, 'admin'), 'npm run build:libs']
    ])
  })

  it('refuses to write a tracked env file and fails the env step', async () => {
    deps.isGitIgnored = async (_path, rel) => rel !== '.env'
    await new DevEnvSetupPipeline(deps).run('e1')
    expect(env.setup.env).toMatchObject({
      status: 'failed',
      error: 'eshop/.env is tracked by git; Orca only writes ignored files'
    })
    expect(written.size).toBe(0)
    expect(env.setup.install).toBeUndefined()
  })

  it('fails the env step naming an unresolved dependency', async () => {
    const template: DevEnvTemplate = {
      ...TEMPLATE,
      slots: [
        {
          ...TEMPLATE.slots[0],
          envFiles: [{ path: '.env', lines: [{ key: 'API', value: '${dep.admin-api.url}' }] }]
        }
      ]
    }
    deps.getSettings = () => ({ ...SETTINGS, devEnvTemplates: [template] })
    await new DevEnvSetupPipeline(deps).run('e1', { steps: ['env'] })
    expect(env.setup.env).toMatchObject({
      status: 'failed',
      error: 'eshop/.env: API: Unresolved ${dep.admin-api.url}'
    })
  })

  it('fails install naming the command and stops the run', async () => {
    execResult = (args) => (args.at(-1) === 'npm run build:libs' ? 7 : 0)
    await new DevEnvSetupPipeline(deps).run('e1')
    expect(env.setup.install).toMatchObject({
      status: 'failed',
      error: 'admin: "npm run build:libs" failed (exit 7)'
    })
    expect(env.setup.infra).toBeUndefined()
  })

  it('re-runs only the requested slots', async () => {
    await new DevEnvSetupPipeline(deps).run('e1', { steps: ['env', 'install'], slots: ['eshop'] })
    expect(execCalls.every((call) => call.cwd === join(root, 'eshop'))).toBe(true)
    expect([...written.keys()]).toEqual([join(root, 'eshop/.env')])
  })

  it('runs the seed when asked', async () => {
    await new DevEnvSetupPipeline(deps).run('e1', { steps: ['seed'], withSeed: true })
    expect(env.setup.seed?.status).toBe('done')
    expect(execCalls.map((call) => [call.cwd, call.args.at(-1)])).toEqual([
      [join(root, 'eshop'), 'npm run seed']
    ])
  })

  it('rejects a concurrent run', async () => {
    let release: () => void = () => {}
    deps.infra.ensure = () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, started: [] })
      })
    const pipeline = new DevEnvSetupPipeline(deps)
    const first = pipeline.run('e1', { steps: ['infra'] })
    await expect(pipeline.run('e1')).rejects.toThrow('Setup is already running')
    expect(pipeline.isRunning('e1')).toBe(true)
    release()
    await first
    expect(pipeline.isRunning('e1')).toBe(false)
  })

  it('fails the first step when the template no longer exists', async () => {
    deps.getSettings = () => ({ ...SETTINGS, devEnvTemplates: [] })
    await new DevEnvSetupPipeline(deps).run('e1')
    expect(env.setup.ports).toMatchObject({
      status: 'failed',
      error: 'Template "t1" no longer exists'
    })
  })

  it('reads personal values files and fails naming a missing one', async () => {
    const valuesPath = join(root, 'personal.env')
    writeFileSync(valuesPath, 'API_PARTNER_SECRET=abc\n')
    const withValues = (valuesFile: string): DevEnvTemplate => ({
      ...TEMPLATE,
      slots: [
        { ...TEMPLATE.slots[0], envFiles: [{ ...TEMPLATE.slots[0].envFiles[0], valuesFile }] }
      ]
    })
    deps.getSettings = () => ({ ...SETTINGS, devEnvTemplates: [withValues(valuesPath)] })
    await new DevEnvSetupPipeline(deps).run('e1', { steps: ['env'] })
    expect(readFileSync(join(root, 'eshop/.env'), 'utf8')).toContain('API_PARTNER_SECRET=abc')
    deps.getSettings = () => ({
      ...SETTINGS,
      devEnvTemplates: [withValues(join(root, 'missing.env'))]
    })
    await new DevEnvSetupPipeline(deps).run('e1', { steps: ['env'] })
    expect(env.setup.env).toMatchObject({
      status: 'failed',
      error: `eshop/.env: values file not found: ${join(root, 'missing.env')}`
    })
  })

  it('writes a log per step', async () => {
    const pipeline = new DevEnvSetupPipeline(deps)
    await pipeline.run('e1', { steps: ['env'] })
    expect(readFileSync(pipeline.getLogPath('e1', 'env'), 'utf8')).toContain('eshop/.env')
  })
})

describe('isDevEnvFileGitIgnored', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-dev-env-ignored-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('in a folder workspace accepts only new files or files Orca rendered', async () => {
    expect(await isDevEnvFileGitIgnored(dir, '.env')).toBe(true)
    writeFileSync(join(dir, '.env'), 'HAND=1\n')
    expect(await isDevEnvFileGitIgnored(dir, '.env')).toBe(false)
    writeFileSync(join(dir, '.env'), '# --- DYNAMIC (k, do not edit) ---\nA=1\n')
    expect(await isDevEnvFileGitIgnored(dir, '.env')).toBe(true)
  })

  it('in a git worktree trusts git check-ignore', async () => {
    mkdirSync(join(dir, '.git'))
    const exec: DevEnvExec = async (_program, args) => ({
      code: args.at(-1) === '.env' ? 0 : 1,
      stdout: '',
      stderr: '',
      timedOut: false
    })
    expect(await isDevEnvFileGitIgnored(dir, '.env', exec)).toBe(true)
    expect(await isDevEnvFileGitIgnored(dir, 'tracked.env', exec)).toBe(false)
  })
})
