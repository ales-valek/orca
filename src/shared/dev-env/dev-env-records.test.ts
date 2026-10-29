import { describe, expect, it } from 'vitest'
import { normalizeDevEnvs } from './dev-env-records'
import type { DevEnv } from './dev-env-types'

const ENV: DevEnv = {
  id: 'e1',
  key: 'kiosek',
  name: 'Kiosek',
  templateId: 't1',
  attachment: { kind: 'mission', missionId: 'm1' },
  portSlot: 1,
  slotPins: {},
  slotWorktrees: { eshop: { worktreeId: 'w1', path: '/p', label: 'eshop · preview' }, cms: null },
  bindings: { 'admin-api': { kind: 'local', devEnvId: 'e2' } },
  setup: { ports: { status: 'done', finishedAt: 1 } },
  createdAt: 1
}

describe('normalizeDevEnvs', () => {
  it('keeps a valid record unchanged', () => {
    expect(normalizeDevEnvs([ENV])).toEqual([ENV])
  })

  it('drops records without id, key, templateId or attachment', () => {
    const { id: _id, ...noId } = ENV
    const { attachment: _a, ...noAttachment } = ENV
    expect(
      normalizeDevEnvs([noId, { ...ENV, key: '' }, { ...ENV, templateId: 3 }, noAttachment, 'x'])
    ).toEqual([])
  })

  it('drops a binding whose kind is not local', () => {
    const [env] = normalizeDevEnvs([
      {
        ...ENV,
        bindings: { a: { kind: 'remote', tier: 'prod' }, b: { kind: 'local', devEnvId: 'e3' } }
      }
    ])
    expect(env.bindings).toEqual({ b: { kind: 'local', devEnvId: 'e3' } })
  })

  it('drops a record whose port slot is outside 1..99', () => {
    expect(
      normalizeDevEnvs([
        { ...ENV, portSlot: 0 },
        { ...ENV, portSlot: 100 }
      ])
    ).toEqual([])
  })

  it('drops unknown setup steps and statuses', () => {
    const [env] = normalizeDevEnvs([
      {
        ...ENV,
        setup: { ports: { status: 'done' }, bogus: { status: 'done' }, env: { status: 'weird' } }
      }
    ])
    expect(env.setup).toEqual({ ports: { status: 'done' } })
  })

  it('marks a step that was running when Orca quit as interrupted', () => {
    const [env] = normalizeDevEnvs([
      { ...ENV, setup: { install: { status: 'running', startedAt: 5 } } }
    ])
    expect(env.setup.install).toEqual({
      status: 'failed',
      startedAt: 5,
      error: 'Interrupted: Orca quit while this step was running'
    })
  })

  it('returns an empty list for non-arrays', () => {
    expect(normalizeDevEnvs(undefined)).toEqual([])
  })
})
