import { describe, expect, it } from 'vitest'
import type { Mission } from '../mission-types'
import {
  getMovedDevEnvSlots,
  getRequiredDevEnvDependencies,
  resolveMissionSlotWorktrees,
  resolveStandaloneSlotWorktrees,
  type DevEnvWorktreeLookup
} from './dev-env-slot-binding'
import type { DevEnvServiceDef, DevEnvTemplate } from './dev-env-types'

const SERVICE: DevEnvServiceDef = { name: 'x', command: 'run', portOffset: 0, dependsOn: [] }

const TEMPLATE: DevEnvTemplate = {
  id: 't',
  name: 'T',
  dependencies: [],
  credentials: [],
  slots: [
    {
      name: 'eshop',
      repoId: 'repo-eshop',
      install: [],
      envFiles: [],
      services: [{ ...SERVICE, name: 'eshop' }]
    },
    {
      name: 'admin',
      repoId: 'repo-admin',
      install: [],
      envFiles: [],
      services: [
        { ...SERVICE, name: 'admin-api' },
        { ...SERVICE, name: 'geo' }
      ]
    }
  ]
}

const WORKTREES: Record<string, { path: string; repoId: string; label: string }> = {
  'w-eshop-member': { path: '/m/eshop', repoId: 'repo-eshop', label: 'mission/kiosek' },
  'w-eshop-preview': {
    path: '/m/eshop--preview',
    repoId: 'repo-eshop',
    label: 'mission-preview/kiosek'
  },
  'w-eshop-task': { path: '/m/eshop--om-955', repoId: 'repo-eshop', label: 'OM-955' },
  'w-admin-member': { path: '/m/admin', repoId: 'repo-admin', label: 'mission/kiosek' }
}
const lookup: DevEnvWorktreeLookup = (id) => WORKTREES[id] ?? null

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    name: 'Kiosek',
    branchName: 'mission/kiosek',
    members: [
      { repoId: 'repo-eshop', worktreeId: 'w-eshop-member', addedAt: 1 },
      { repoId: 'repo-admin', worktreeId: 'w-admin-member', addedAt: 1 }
    ],
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('resolveMissionSlotWorktrees', () => {
  it('uses the member worktree when there is no preview', () => {
    expect(resolveMissionSlotWorktrees(makeMission(), TEMPLATE, {}, lookup).eshop).toEqual({
      worktreeId: 'w-eshop-member',
      path: '/m/eshop',
      label: 'eshop · mission branch'
    })
  })

  it('prefers the preview over the member', () => {
    const mission = makeMission({
      previews: [{ repoId: 'repo-eshop', worktreeId: 'w-eshop-preview' }]
    })
    expect(resolveMissionSlotWorktrees(mission, TEMPLATE, {}, lookup).eshop?.worktreeId).toBe(
      'w-eshop-preview'
    )
  })

  it('prefers a pin over the preview', () => {
    const mission = makeMission({
      previews: [{ repoId: 'repo-eshop', worktreeId: 'w-eshop-preview' }]
    })
    expect(
      resolveMissionSlotWorktrees(mission, TEMPLATE, { eshop: 'w-eshop-task' }, lookup).eshop
    ).toEqual({
      worktreeId: 'w-eshop-task',
      path: '/m/eshop--om-955',
      label: 'eshop · OM-955'
    })
  })

  it('ignores a pin whose worktree is gone', () => {
    expect(
      resolveMissionSlotWorktrees(makeMission(), TEMPLATE, { eshop: 'gone' }, lookup).eshop
        ?.worktreeId
    ).toBe('w-eshop-member')
  })

  it('leaves a slot unbound when the repo is not in the mission', () => {
    const mission = makeMission({
      members: [{ repoId: 'repo-eshop', worktreeId: 'w-eshop-member', addedAt: 1 }]
    })
    expect(resolveMissionSlotWorktrees(mission, TEMPLATE, {}, lookup).admin).toBeNull()
  })
})

describe('resolveStandaloneSlotWorktrees', () => {
  it('fills only the slot of the worktree repo', () => {
    const slots = resolveStandaloneSlotWorktrees(
      { id: 'w9', repoId: 'repo-eshop', path: '/w/eshop-fix', label: 'fix/OMP-3011' },
      TEMPLATE
    )
    expect(slots).toEqual({
      eshop: { worktreeId: 'w9', path: '/w/eshop-fix', label: 'eshop · fix/OMP-3011' },
      admin: null
    })
  })
})

describe('getMovedDevEnvSlots', () => {
  it('reports slots whose worktree changed', () => {
    const a = { worktreeId: 'a', path: '/a', label: 'a' }
    const b = { worktreeId: 'b', path: '/b', label: 'b' }
    const c = { worktreeId: 'c', path: '/c', label: 'c' }
    expect(getMovedDevEnvSlots({ eshop: a, admin: b }, { eshop: c, admin: b })).toEqual(['eshop'])
    expect(getMovedDevEnvSlots({ eshop: a }, { eshop: null })).toEqual(['eshop'])
  })
})

describe('getRequiredDevEnvDependencies', () => {
  it('requires declared dependencies plus services of unbound slots', () => {
    const template = { ...TEMPLATE, dependencies: ['media', 'geo'] }
    expect(
      getRequiredDevEnvDependencies(template, {
        eshop: { worktreeId: 'w', path: '/w', label: 'w' },
        admin: null
      })
    ).toEqual(['admin-api', 'geo', 'media'])
  })
})
