import type { MissionSlot } from './mission-types'

export type MissionLayerState =
  | 'current'
  | 'stale'
  | 'blocked'
  | 'conflict'
  | 'needs-push'
  | 'merged'

export type MissionLayerStateInput = {
  /** Tip of the branch below; null for a layer with no parent or a missing parent branch. */
  parentTip: string | null
  /** Parent tip this layer was last based on; null when unknown or the layer has no parent. */
  parentBaseSha: string | null
  isClean: boolean
  isAgentWorking: boolean
  /** A rebase, merge or cherry-pick is in progress in the layer's checkout. */
  conflict: boolean
  prMerged: boolean
  localTip: string | null
  pushedTip: string | null
  hasOpenPr: boolean
}

export type MissionRestackLayer = {
  slot: MissionSlot
  state: MissionLayerState
  /** Why a layer is blocked when git or the record explains it. */
  reason?: string
}

export type MissionRestackReport = { repoId: string; layers: MissionRestackLayer[] }

/** Precedence: merged > conflict > blocked (stale but dirty/busy) > stale > needs-push > current. */
export function deriveMissionLayerState(input: MissionLayerStateInput): MissionLayerState {
  if (input.prMerged) {
    return 'merged'
  }
  if (input.conflict) {
    return 'conflict'
  }
  if (input.parentTip !== input.parentBaseSha) {
    // Why: `rebase --onto` needs both ends; guessing either could replay foreign commits.
    if (input.parentTip === null || input.parentBaseSha === null) {
      return 'blocked'
    }
    return !input.isClean || input.isAgentWorking ? 'blocked' : 'stale'
  }
  if (input.hasOpenPr && input.localTip !== input.pushedTip) {
    return 'needs-push'
  }
  return 'current'
}

/** Why a layer derives as `blocked`, or null when it does not. */
export function getMissionLayerBlockedReason(input: MissionLayerStateInput): string | null {
  if (deriveMissionLayerState(input) !== 'blocked') {
    return null
  }
  if (input.parentTip === null) {
    return 'Parent branch missing'
  }
  if (input.parentBaseSha === null) {
    return 'No recorded base'
  }
  return input.isClean ? 'Agent is working' : 'Uncommitted changes'
}
