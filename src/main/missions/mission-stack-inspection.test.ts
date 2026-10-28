import { describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import type { MissionLayerPushTips, MissionRestackReport } from '../../shared/mission-layer-state'
import { inspectMissionStacks } from './mission-stack-inspection'

const mission: Mission = {
  id: 'm1',
  name: 'Referral',
  branchName: 'mission/referral',
  members: [
    { repoId: 'r1', worktreeId: 'r1::/wt/r1', addedAt: 1 },
    { repoId: 'r2', worktreeId: 'r2::/wt/r2', addedAt: 1 }
  ],
  tasks: [
    {
      id: 't1',
      repoId: 'r1',
      order: 1,
      title: 'First',
      branchName: 'mission-task/referral/t1',
      worktreeId: 'r1::/wt/t1',
      parentBaseSha: 'a',
      addedAt: 1
    }
  ],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

const r1Report: MissionRestackReport = {
  repoId: 'r1',
  layers: [
    { slot: 'member', state: 'current' },
    { slot: 'task:t1', state: 'current' },
    { slot: 'preview', state: 'current' }
  ]
}

function getStatesBySlot(report: MissionRestackReport | undefined): Record<string, string> {
  return Object.fromEntries((report?.layers ?? []).map((layer) => [layer.slot, layer.state]))
}

describe('inspectMissionStacks', () => {
  it('inspects only repos with tasks and marks moved published layers as needs-push', async () => {
    const inspectRepo = vi.fn(async () => r1Report)
    const tips = new Map<string, MissionLayerPushTips>([
      ['mission/referral', { localTip: 'm', pushedTip: 'm' }],
      ['mission-task/referral/t1', { localTip: 'new', pushedTip: 'old' }]
    ])
    const readPushTips = vi.fn(async () => tips)

    const reports = await inspectMissionStacks(mission, { inspectRepo, readPushTips })

    expect(inspectRepo).toHaveBeenCalledTimes(1)
    expect(inspectRepo).toHaveBeenCalledWith(mission, 'r1')
    expect(readPushTips).toHaveBeenCalledWith('r1', [
      'mission/referral',
      'mission-task/referral/t1'
    ])
    expect(getStatesBySlot(reports[0])).toEqual({
      member: 'current',
      'task:t1': 'needs-push',
      preview: 'current'
    })
  })

  it('keeps never-pushed layers current', async () => {
    const reports = await inspectMissionStacks(mission, {
      inspectRepo: async () => r1Report,
      readPushTips: async () =>
        new Map([['mission-task/referral/t1', { localTip: 'new', pushedTip: null }]])
    })
    expect(getStatesBySlot(reports[0])['task:t1']).toBe('current')
  })

  it('falls back to the read-only states when push tips cannot be read', async () => {
    const reports = await inspectMissionStacks(mission, {
      inspectRepo: async () => r1Report,
      readPushTips: async () => {
        throw new Error('no remote')
      }
    })
    expect(reports).toEqual([r1Report])
  })
})
