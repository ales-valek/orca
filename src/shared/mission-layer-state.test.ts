import { describe, expect, it } from 'vitest'
import {
  deriveMissionLayerState,
  getMissionLayerBlockedReason,
  getMissionLayerPushInput,
  isMissionLayerPushPending,
  type MissionLayerPushTips,
  type MissionLayerStateInput
} from './mission-layer-state'

const current: MissionLayerStateInput = {
  parentTip: 'p1',
  parentBaseSha: 'p1',
  isClean: true,
  isAgentWorking: false,
  conflict: false,
  prMerged: false,
  localTip: 'l1',
  pushedTip: 'l1',
  hasOpenPr: false
}
const stale = { ...current, parentTip: 'p2' }

describe('deriveMissionLayerState', () => {
  it.each<[string, Partial<MissionLayerStateInput>, string]>([
    ['parent unchanged', {}, 'current'],
    ['parent moved, clean and idle', { parentTip: 'p2' }, 'stale'],
    ['parent moved, dirty', { parentTip: 'p2', isClean: false }, 'blocked'],
    ['parent moved, agent working', { parentTip: 'p2', isAgentWorking: true }, 'blocked'],
    ['dirty but parent unchanged', { isClean: false }, 'current'],
    ['parent moved, unknown fork point', { parentTip: 'p2', parentBaseSha: null }, 'blocked'],
    ['parent branch missing', { parentTip: null }, 'blocked'],
    ['no parent at all', { parentTip: null, parentBaseSha: null }, 'current'],
    ['rewritten with an open PR', { localTip: 'l2', hasOpenPr: true }, 'needs-push'],
    ['rewritten without a PR', { localTip: 'l2' }, 'current'],
    ['PR merged', { prMerged: true, conflict: true, parentTip: 'p2' }, 'merged']
  ])('%s', (_name, overrides, expected) => {
    expect(deriveMissionLayerState({ ...current, ...overrides })).toBe(expected)
  })

  it('reports a conflict over every state but merged', () => {
    expect(deriveMissionLayerState({ ...stale, isClean: false, conflict: true })).toBe('conflict')
    expect(
      deriveMissionLayerState({ ...current, conflict: true, localTip: 'l2', hasOpenPr: true })
    ).toBe('conflict')
  })

  it('prefers stale over needs-push so the layer is restacked before it is pushed', () => {
    expect(deriveMissionLayerState({ ...stale, localTip: 'l2', hasOpenPr: true })).toBe('stale')
  })
})

describe('getMissionLayerBlockedReason', () => {
  it.each<[string, Partial<MissionLayerStateInput>, string | null]>([
    ['parent branch missing', { parentTip: null }, 'Parent branch missing'],
    ['no recorded base', { parentTip: 'p2', parentBaseSha: null }, 'No recorded base'],
    ['dirty', { parentTip: 'p2', isClean: false }, 'Uncommitted changes'],
    ['agent busy', { parentTip: 'p2', isAgentWorking: true }, 'Agent is working'],
    ['not blocked', { parentTip: 'p2' }, null]
  ])('%s', (_name, overrides, expected) => {
    expect(getMissionLayerBlockedReason({ ...current, ...overrides })).toBe(expected)
  })
})

describe('needs-push rule', () => {
  it.each<[string, MissionLayerPushTips, boolean]>([
    ['never pushed', { localTip: 'l2', pushedTip: null }, false],
    ['pushed and unchanged', { localTip: 'l1', pushedTip: 'l1' }, false],
    ['pushed and moved', { localTip: 'l2', pushedTip: 'l1' }, true]
  ])('%s', (_title, tips, pending) => {
    // Both the push action and the sidebar badge derive from these two calls.
    expect(isMissionLayerPushPending(getMissionLayerPushInput(tips))).toBe(pending)
    expect(deriveMissionLayerState({ ...current, ...getMissionLayerPushInput(tips) })).toBe(
      pending ? 'needs-push' : 'current'
    )
  })
})
