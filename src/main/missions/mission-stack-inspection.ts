import {
  getMissionLayerPushInput,
  isMissionLayerPushPending,
  type MissionLayerPushTips,
  type MissionRestackLayer,
  type MissionRestackReport
} from '../../shared/mission-layer-state'
import { getMissionSlotBranch, getRepoTaskStack } from '../../shared/mission-task-stack'
import type { Mission } from '../../shared/mission-types'

export type MissionStackInspectionDeps = {
  inspectRepo: (mission: Mission, repoId: string) => Promise<MissionRestackReport>
  readPushTips: (
    repoId: string,
    branches: readonly string[]
  ) => Promise<Map<string, MissionLayerPushTips>>
}

function isPushableCurrentLayer(layer: MissionRestackLayer): boolean {
  return layer.state === 'current' && layer.slot !== 'preview'
}

async function applyNeedsPush(
  mission: Mission,
  report: MissionRestackReport,
  readPushTips: MissionStackInspectionDeps['readPushTips']
): Promise<MissionRestackReport> {
  const branchBySlot = new Map<string, string>()
  for (const layer of report.layers.filter(isPushableCurrentLayer)) {
    const branch = getMissionSlotBranch(mission, report.repoId, layer.slot)
    if (branch) {
      branchBySlot.set(layer.slot, branch)
    }
  }
  if (branchBySlot.size === 0) {
    return report
  }
  let tips: Map<string, MissionLayerPushTips>
  try {
    tips = await readPushTips(report.repoId, [...branchBySlot.values()])
  } catch {
    return report
  }
  return {
    ...report,
    layers: report.layers.map((layer) => {
      const branch = branchBySlot.get(layer.slot)
      const tip = branch ? tips.get(branch) : undefined
      // Why: a current layer is exactly one whose parent did not move, so only the push rule remains.
      return tip && isMissionLayerPushPending(getMissionLayerPushInput(tip))
        ? { ...layer, state: 'needs-push' }
        : layer
    })
  }
}

/** Read-only layer states of every repo with tasks; a current layer that moved since its last push needs a push. */
export async function inspectMissionStacks(
  mission: Mission,
  deps: MissionStackInspectionDeps
): Promise<MissionRestackReport[]> {
  const repoIds = mission.members
    .map((member) => member.repoId)
    .filter((repoId) => getRepoTaskStack(mission, repoId).length > 0)
  const reports = await Promise.all(
    repoIds.map(async (repoId) => {
      try {
        const report = await deps.inspectRepo(mission, repoId)
        return await applyNeedsPush(mission, report, deps.readPushTips)
      } catch (error) {
        console.error('[missions] layer inspection failed:', error)
        return null
      }
    })
  )
  return reports.filter((report): report is MissionRestackReport => report !== null)
}
