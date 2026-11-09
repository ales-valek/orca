import { closeTestStores, testState, createStore } from './persistence/persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DevEnv } from '../shared/dev-env/dev-env-types'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

vi.mock('./telemetry/client', () => ({
  track: trackMock
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))
const ENV: DevEnv = {
  id: 'e1',
  key: 'kiosek',
  name: 'Kiosek',
  templateId: 't1',
  attachment: { kind: 'mission', missionId: 'm1' },
  portSlot: 1,
  slotPins: {},
  slotWorktrees: {},
  bindings: {},
  setup: {},
  createdAt: 1
}

describe('dev env persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates, reads, updates and deletes dev envs', () => {
    const store = createStore()
    expect(store.getDevEnvs()).toEqual([])
    store.createDevEnv(ENV)
    expect(store.getDevEnv('e1')).toEqual(ENV)
    const updated = store.updateDevEnv('e1', { setup: { ports: { status: 'done' } } })
    expect(updated).toEqual({ ...ENV, setup: { ports: { status: 'done' } } })
    expect(store.deleteDevEnv('e1')).toBe(true)
    expect(store.getDevEnv('e1')).toBeNull()
    expect(store.deleteDevEnv('e1')).toBe(false)
  })

  it('returns null when updating an unknown dev env', () => {
    const store = createStore()
    expect(store.updateDevEnv('missing', { detached: true })).toBeNull()
  })

  it('keeps dev envs across a reload', () => {
    const store = createStore()
    store.createDevEnv(ENV)
    store.flushOrThrow()
    expect(createStore().getDevEnv('e1')).toEqual(ENV)
  })
})
