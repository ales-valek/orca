import { describe, expect, it } from 'vitest'
import { getDevEnvBadgeLabel, getDevEnvSetupRows } from './dev-env-labels'

describe('getDevEnvBadgeLabel', () => {
  it('labels each badge state', () => {
    const base = { envId: 'e', up: 2, total: 3 }
    expect(getDevEnvBadgeLabel({ ...base, state: 'running', up: 3 })).toEqual({
      text: '3/3',
      tone: 'ok'
    })
    expect(getDevEnvBadgeLabel({ ...base, state: 'partial' })).toEqual({
      text: '2/3',
      tone: 'warn'
    })
    expect(getDevEnvBadgeLabel({ ...base, state: 'failed' })).toEqual({
      text: 'setup',
      tone: 'error'
    })
    expect(getDevEnvBadgeLabel({ ...base, state: 'setting-up' })).toEqual({
      text: 'setup…',
      tone: 'info'
    })
    expect(getDevEnvBadgeLabel({ ...base, state: 'stopped' })).toEqual({
      text: 'stopped',
      tone: 'muted'
    })
  })
})

describe('getDevEnvSetupRows', () => {
  it('lists every step in order with pending for missing ones', () => {
    const rows = getDevEnvSetupRows({
      setup: { ports: { status: 'done', startedAt: 1, finishedAt: 101 } }
    })
    expect(rows.map((row) => [row.step, row.status])).toEqual([
      ['ports', 'done'],
      ['env', 'pending'],
      ['install', 'pending'],
      ['infra', 'pending'],
      ['data', 'pending'],
      ['seed', 'pending']
    ])
    expect(rows[0]).toMatchObject({ label: '1 · Allocate ports', durationMs: 100, canRerun: true })
  })

  it('disables re-run while any step runs', () => {
    const rows = getDevEnvSetupRows({ setup: { install: { status: 'running' } } })
    expect(rows.every((row) => !row.canRerun)).toBe(true)
  })
})
