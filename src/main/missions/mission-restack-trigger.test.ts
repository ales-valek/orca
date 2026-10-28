import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/mission-types'
import { MissionRestackTrigger } from './mission-restack-trigger'

const MISSION: Mission = {
  id: 'm1',
  name: 'Kiosek',
  branchName: 'mission/kiosek',
  members: [{ repoId: 'r1', worktreeId: 'r1::/root/api', addedAt: 1 }],
  tasks: [
    {
      id: 'a',
      repoId: 'r1',
      order: 1,
      title: 'A',
      branchName: 'mission-task/kiosek/a',
      worktreeId: 'r1::/root/api--a',
      parentBaseSha: null,
      addedAt: 1
    }
  ],
  previews: [{ repoId: 'r1', worktreeId: 'r1::/root/api--preview' }],
  tabOrder: 0,
  createdAt: 1,
  updatedAt: 1
}

const META: Record<string, { missionId?: string; missionSlot?: string }> = {
  'r1::/root/api': { missionId: 'm1' },
  'r1::/root/api--a': { missionId: 'm1', missionSlot: 'task:a' },
  'r1::/root/api--preview': { missionId: 'm1', missionSlot: 'preview' },
  'r1::/elsewhere': {}
}

function makeTrigger(restack = vi.fn(async () => [])) {
  const trigger = new MissionRestackTrigger({
    store: {
      getMissions: () => [MISSION],
      getMission: (id) => (id === MISSION.id ? MISSION : null),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the trigger only reads missionId and missionSlot.
      getWorktreeMeta: (id) => META[id] as never
    },
    restack
  })
  return { trigger, restack }
}

describe('MissionRestackTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restacks a repo once, 2 s after the last agent turn ended in its member or task worktree', async () => {
    const { trigger, restack } = makeTrigger()

    trigger.onAgentTurnEnded('r1::/root/api--a')
    await vi.advanceTimersByTimeAsync(1500)
    trigger.onAgentTurnEnded('r1::/root/api')
    await vi.advanceTimersByTimeAsync(1999)
    expect(restack).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(restack).toHaveBeenCalledTimes(1)
    expect(restack).toHaveBeenCalledWith({ missionId: 'm1', repoId: 'r1' })
  })

  it('ignores preview, non-Mission and unknown worktrees', async () => {
    const { trigger, restack } = makeTrigger()

    trigger.onAgentTurnEnded('r1::/root/api--preview')
    trigger.onAgentTurnEnded('r1::/elsewhere')
    trigger.onAgentTurnEnded('r1::/unknown')
    await vi.advanceTimersByTimeAsync(5000)

    expect(restack).not.toHaveBeenCalled()
  })

  it('restacks after a manual pull-rebase of the member worktree only', async () => {
    const { trigger, restack } = makeTrigger()

    trigger.onWorktreeRebased('/root/api--a')
    await vi.advanceTimersByTimeAsync(5000)
    expect(restack).not.toHaveBeenCalled()

    trigger.onWorktreeRebased('/root/api')
    await vi.advanceTimersByTimeAsync(2000)
    expect(restack).toHaveBeenCalledWith({ missionId: 'm1', repoId: 'r1' })
  })

  it('logs a failed restack instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { trigger } = makeTrigger(
      vi.fn(async () => {
        throw new Error('boom')
      })
    )

    trigger.onAgentTurnEnded('r1::/root/api')
    await vi.advanceTimersByTimeAsync(2000)

    expect(error).toHaveBeenCalledWith('[missions] automatic restack failed:', 'boom')
    error.mockRestore()
  })
})
