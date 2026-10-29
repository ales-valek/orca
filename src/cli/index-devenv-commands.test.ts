import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { okFixture, queueFixtures } from './test-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

const DETAIL = {
  id: 'e1',
  key: 'kiosek',
  name: 'Kiosek',
  templateName: 'OrderMage full',
  attachmentLabel: 'Mission Kiosek',
  portRange: { first: 20100, last: 20199 },
  badge: { envId: 'e1', state: 'partial', up: 1, total: 2 },
  services: [
    { name: 'admin-api', slot: 'admin', status: 'up', port: 20110, url: 'http://127.0.0.1:20110' },
    {
      name: 'eshop',
      slot: 'eshop',
      status: 'crashed',
      port: 20150,
      url: 'http://eshop.kiosek.orca.localhost',
      exitCode: 1
    }
  ],
  setup: {},
  requiredDependencies: [],
  dependencyStates: {},
  credentials: []
}

describe('orca devenv commands', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('shows an environment with its services', async () => {
    queueFixtures(callMock, okFixture('req_1', DETAIL))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['devenv', 'show', 'kiosek'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('devenv.show', { env: 'kiosek' })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Kiosek')
    expect(output).toContain('20100–20199')
    expect(output).toMatch(/up\s+admin-api\s+20110\s+http:\/\/127\.0\.0\.1:20110/)
    expect(output).toMatch(/crashed\s+eshop/)
  })

  it('prints env values with masked secrets and their sources', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', {
        files: [
          {
            slot: 'admin',
            path: '.env',
            values: [
              { key: 'PORT', value: '20110', section: 'DYNAMIC', sources: ['port'], secret: false },
              { key: 'MAPS', value: '••••••', section: 'SECRET', sources: ['secret'], secret: true }
            ]
          }
        ]
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['devenv', 'env', 'kiosek', '--file', 'admin/.env'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('devenv.env', { env: 'kiosek', file: 'admin/.env' })
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('PORT=20110  [port]')
    expect(output).toContain('MAPS=••••••  [secret]')
  })

  it('unbinds a dependency with --provider none', async () => {
    queueFixtures(callMock, okFixture('req_1', { id: 'e1' }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['devenv', 'bind', 'kiosek', '--dependency', 'admin-api', '--provider', 'none'],
      '/tmp'
    )

    expect(callMock).toHaveBeenCalledWith('devenv.bind', {
      env: 'kiosek',
      dependency: 'admin-api',
      provider: null
    })
  })

  it('forwards --devenv-template on mission create', async () => {
    queueFixtures(
      callMock,
      okFixture('req_1', { mission: { id: 'm1', name: 'X', members: [] }, memberResults: [] })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['mission', 'create', '--name', 'X', '--repo', 'api', '--devenv-template', 'OrderMage'],
      '/tmp'
    )

    expect(callMock).toHaveBeenCalledWith(
      'mission.create',
      expect.objectContaining({ devEnvTemplate: 'OrderMage' })
    )
  })
})
