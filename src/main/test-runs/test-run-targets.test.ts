import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DevEnv } from '../../shared/dev-env/dev-env-types'
import {
  buildTestRunTargetMap,
  getDevEnvForWorktree,
  writeTestRunTargetMap
} from './test-run-targets'

function makeEnv(id: string, overrides: Partial<DevEnv> = {}): DevEnv {
  return {
    id,
    key: id,
    name: id,
    templateId: 't',
    attachment: { kind: 'mission', missionId: `m-${id}` },
    portSlot: 0,
    slotPins: {},
    slotWorktrees: {},
    bindings: {},
    setup: {},
    createdAt: 0,
    ...overrides
  }
}

const slot = (worktreeId: string) => ({ worktreeId, path: `/w/${worktreeId}`, label: worktreeId })

describe('test run targets', () => {
  it('maps attachment and slot worktrees to their environment', () => {
    const envs = [
      makeEnv('kiosek', {
        slotWorktrees: { eshop: slot('w-eshop'), tests: slot('w-tests'), admin: null }
      }),
      makeEnv('solo', { attachment: { kind: 'worktree', worktreeId: 'w-solo' } })
    ]
    expect(buildTestRunTargetMap(envs)).toEqual({
      'w-eshop': 'kiosek',
      'w-tests': 'kiosek',
      'w-solo': 'solo'
    })
    expect(getDevEnvForWorktree(envs, 'w-tests')?.id).toBe('kiosek')
    expect(getDevEnvForWorktree(envs, 'nope')).toBeNull()
  })

  it('prefers the attachment when a worktree is in two environments', () => {
    const envs = [
      makeEnv('mission', { slotWorktrees: { eshop: slot('w1') } }),
      makeEnv('own', { attachment: { kind: 'worktree', worktreeId: 'w1' } })
    ]
    expect(buildTestRunTargetMap(envs)).toEqual({ w1: 'own' })
    expect(getDevEnvForWorktree(envs, 'w1')?.id).toBe('own')
  })

  it('writes the map for the run lock and reporter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-test-run-targets-'))
    try {
      writeTestRunTargetMap(dir, [
        makeEnv('solo', { attachment: { kind: 'worktree', worktreeId: 'w' } })
      ])
      expect(JSON.parse(readFileSync(join(dir, 'targets.json'), 'utf8'))).toEqual({ w: 'solo' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
