import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import { MISSION_ROOT_MARKER_NAME } from './mission-root'
import {
  findMissionForPath,
  resolveMissionSelector,
  toRuntimeMissionRecord
} from './mission-runtime-records'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'mission-records-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function makeMission(overrides: Partial<Mission> & Pick<Mission, 'id' | 'name'>): Mission {
  return {
    branchName: `mission/${overrides.name.toLowerCase()}`,
    members: [],
    tabOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('resolveMissionSelector', () => {
  const missions = [
    makeMission({ id: 'm1', name: 'Referral' }),
    makeMission({ id: 'm2', name: 'Billing' }),
    makeMission({ id: 'm3', name: 'Billing' })
  ]

  it('resolves prefixed and bare ids and names', () => {
    expect(resolveMissionSelector(missions, 'id:m2').id).toBe('m2')
    expect(resolveMissionSelector(missions, 'name:Referral').id).toBe('m1')
    expect(resolveMissionSelector(missions, 'm3').id).toBe('m3')
    expect(resolveMissionSelector(missions, 'Referral').id).toBe('m1')
  })

  it('reports ambiguous and unknown selectors', () => {
    expect(() => resolveMissionSelector(missions, 'Billing')).toThrow('selector_ambiguous')
    expect(() => resolveMissionSelector(missions, 'nope')).toThrow('selector_not_found')
    expect(() => resolveMissionSelector(missions, 'id:Referral')).toThrow('selector_not_found')
  })
})

describe('findMissionForPath', () => {
  it('walks up to the root marker of a recorded Mission root', () => {
    const rootPath = path.join(tmp, 'missions', 'referral')
    const nested = path.join(rootPath, 'api-1234', 'src')
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      path.join(rootPath, MISSION_ROOT_MARKER_NAME),
      JSON.stringify({ version: 1, missionId: 'm1', links: [] })
    )
    const mission = makeMission({ id: 'm1', name: 'Referral', rootPath })

    expect(findMissionForPath([mission], nested)?.id).toBe('m1')
  })

  it('ignores a marker whose directory is not the Mission recorded root', () => {
    const rootPath = path.join(tmp, 'copied-root')
    mkdirSync(rootPath, { recursive: true })
    writeFileSync(
      path.join(rootPath, MISSION_ROOT_MARKER_NAME),
      JSON.stringify({ version: 1, missionId: 'm1', links: [] })
    )
    const mission = makeMission({
      id: 'm1',
      name: 'Referral',
      rootPath: path.join(tmp, 'elsewhere')
    })

    expect(findMissionForPath([mission], rootPath)).toBeNull()
  })

  it('falls back to a legacy out-of-root member worktree', () => {
    const worktreePath = path.join(tmp, 'legacy', 'web')
    const mission = makeMission({
      id: 'm2',
      name: 'Legacy',
      members: [{ repoId: 'r1', worktreeId: `r1::${worktreePath}`, addedAt: 1 }]
    })

    expect(findMissionForPath([mission], path.join(worktreePath, 'pkg'))?.id).toBe('m2')
    expect(findMissionForPath([mission], path.join(tmp, 'legacy'))).toBeNull()
  })
})

describe('toRuntimeMissionRecord', () => {
  it('projects member repo names, worktree paths, and errors', () => {
    const worktreePath = path.join(tmp, 'root', 'api')
    const mission = makeMission({
      id: 'm1',
      name: 'Referral',
      rootPath: path.join(tmp, 'root'),
      members: [
        { repoId: 'r1', worktreeId: `r1::${worktreePath}`, addedAt: 1 },
        { repoId: 'r2', worktreeId: null, lastError: 'boom', addedAt: 1 }
      ]
    })
    const record = toRuntimeMissionRecord(
      { getRepo: (id) => (id === 'r1' ? { displayName: 'API' } : null) },
      mission
    )

    expect(record).toEqual({
      id: 'm1',
      name: 'Referral',
      branch: 'mission/referral',
      rootPath: path.join(tmp, 'root'),
      members: [
        {
          repoId: 'r1',
          repoName: 'API',
          worktreeId: `r1::${worktreePath}`,
          worktreePath,
          branch: 'mission/referral'
        },
        {
          repoId: 'r2',
          repoName: null,
          worktreeId: null,
          worktreePath: null,
          branch: 'mission/referral',
          error: 'boom'
        }
      ]
    })
  })
})
