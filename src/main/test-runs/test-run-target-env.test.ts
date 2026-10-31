import { describe, expect, it } from 'vitest'
import type { DevEnv } from '../../shared/dev-env/dev-env-types'
import type { TestRunSettings } from '../../shared/test-runs/test-run-settings'
import {
  getCheckoutKey,
  getSourceTargetError,
  getTargetEnv,
  getTargetLockKey
} from './test-run-target-env'

const SETTINGS: TestRunSettings = {
  localEnv: { TEST_ENV: 'local' },
  presets: [{ name: 'dev', env: { TEST_ENV: 'dev' } }]
}

function makeEnv(overrides: Partial<DevEnv>): DevEnv {
  return {
    id: 'kiosek',
    key: 'kiosek',
    name: 'Kiosek',
    templateId: 't',
    attachment: { kind: 'mission', missionId: 'm' },
    portSlot: 0,
    slotPins: {},
    slotWorktrees: {},
    bindings: {},
    setup: {},
    createdAt: 0,
    ...overrides
  }
}

describe('test run targets', () => {
  it('uses local env for a Dev Environment and the preset env for a preset', () => {
    expect(getTargetEnv({ kind: 'dev-env', devEnvId: 'kiosek' }, SETTINGS)).toEqual({
      env: { TEST_ENV: 'local' }
    })
    expect(getTargetEnv({ kind: 'preset', name: 'dev' }, SETTINGS)).toEqual({
      env: { TEST_ENV: 'dev' }
    })
  })

  it('reports an unknown preset', () => {
    expect(getTargetEnv({ kind: 'preset', name: 'qa' }, SETTINGS)).toEqual({
      error: 'Preset qa is not defined in Settings → Dev Environments.'
    })
  })

  it('builds checkout keys safe for folder names', () => {
    expect(getCheckoutKey('repo/1', { kind: 'dev-env', devEnvId: 'kiosek' })).toBe(
      'repo-1__dev-env-kiosek'
    )
  })

  it('builds lock keys', () => {
    expect(getTargetLockKey({ kind: 'dev-env', devEnvId: 'kiosek' })).toBe('dev-env:kiosek')
    expect(getTargetLockKey({ kind: 'preset', name: 'dev' })).toBe('preset:dev')
  })

  it('refuses a worktree of another environment as the test source', () => {
    const slot = (worktreeId: string) => ({
      worktreeId,
      path: `/w/${worktreeId}`,
      label: worktreeId
    })
    const envs = [
      makeEnv({ id: 'kiosek', name: 'Kiosek', slotWorktrees: { tests: slot('w-kiosek-tests') } }),
      makeEnv({ id: 'other', name: 'Other', slotWorktrees: { tests: slot('w-other-tests') } })
    ]
    const target = { kind: 'dev-env' as const, devEnvId: 'kiosek' }
    expect(getSourceTargetError({ sourceWorktreeId: 'w-kiosek-tests', target, envs })).toBeNull()
    expect(getSourceTargetError({ sourceWorktreeId: null, target, envs })).toBeNull()
    expect(getSourceTargetError({ sourceWorktreeId: 'w-other-tests', target, envs })).toBe(
      'This worktree belongs to Other, so its tests would not run against Kiosek. Pick the repo @ origin/main or a worktree of Kiosek.'
    )
    expect(getSourceTargetError({ sourceWorktreeId: 'w-loose', target, envs })).toBe(
      'This worktree belongs to no Dev Environment, so its tests would not run against Kiosek. Pick the repo @ origin/main or a worktree of Kiosek.'
    )
    expect(
      getSourceTargetError({
        sourceWorktreeId: 'w-loose',
        target: { kind: 'preset', name: 'dev' },
        envs
      })
    ).toBeNull()
  })
})
