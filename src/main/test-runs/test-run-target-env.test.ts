import { describe, expect, it } from 'vitest'
import type { DevEnv } from '../../shared/dev-env/dev-env-types'
import type { TestRunSettings } from '../../shared/test-runs/test-run-settings'
import { getTargetEnv, getTargetLockKey, getTargetWorktreeId } from './test-run-target-env'

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
      TEST_ENV: 'local'
    })
    expect(getTargetEnv({ kind: 'preset', name: 'dev' }, SETTINGS)).toEqual({ TEST_ENV: 'dev' })
  })

  it('reports an unknown preset', () => {
    expect(getTargetEnv({ kind: 'preset', name: 'qa' }, SETTINGS)).toEqual({
      error: 'Preset qa is not defined in Settings → Dev Environments.'
    })
  })

  it('builds lock keys', () => {
    expect(getTargetLockKey({ kind: 'dev-env', devEnvId: 'kiosek' })).toBe('dev-env:kiosek')
    expect(getTargetLockKey({ kind: 'preset', name: 'dev' })).toBe('preset:dev')
  })

  it("files a run under the environment's own worktree", () => {
    const slot = { worktreeId: 'w-eshop', path: '/w/eshop', label: 'eshop' }
    expect(
      getTargetWorktreeId({ kind: 'dev-env', devEnvId: 'kiosek' }, [
        makeEnv({
          attachment: { kind: 'worktree', worktreeId: 'w-own' },
          slotWorktrees: { eshop: slot }
        })
      ])
    ).toBe('w-own')
    expect(
      getTargetWorktreeId({ kind: 'dev-env', devEnvId: 'kiosek' }, [
        makeEnv({ slotWorktrees: { admin: null, eshop: slot } })
      ])
    ).toBe('w-eshop')
    expect(getTargetWorktreeId({ kind: 'preset', name: 'dev' }, [])).toBeNull()
  })
})
