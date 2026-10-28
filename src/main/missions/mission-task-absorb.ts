import { getAbsorbHunkLine, planAbsorb } from '../../shared/mission-absorb-plan'
import { getMissionTaskParentBranch, getRepoTaskStack } from '../../shared/mission-task-stack'
import type { Mission, MissionTask } from '../../shared/mission-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import { getFileBlame } from '../git/blame'
import { getBranchTip, listLayerCommits, readLayerWorktree } from '../git/stack-layer-git'
import {
  buildLayerWrites,
  writeLayersThenRevertPreview,
  type AbsorbLayer
} from './mission-absorb-layer-writes'
import {
  readPreviewEdits,
  removeAbsorbedUntrackedFiles,
  toAbsorbHunks,
  type PreviewEdits
} from './mission-preview-edits'
import type { MissionTaskRestack, MissionTaskRestackDeps } from './mission-task-restack'
import { getMissionSlotRecord } from './mission-worktree-ownership'

export type MissionAbsorbResult = {
  applied: number
  ambiguous: { file: string; line: number; candidateTaskIds: string[] }[]
  /** Set when the edits are in their layers but the restack afterwards did not bring them back. */
  warning?: string
}

export type MissionTaskAbsorbDeps = {
  store: MissionTaskRestackDeps['store']
  restacker: MissionTaskRestack
  isWorktreeAgentWorking: (worktreeId: string) => boolean
}

const LAYERS_BUSY = 'mission_absorb_layers_busy'

/** Moves preview edits into the task layers that own the edited lines, all or nothing. */
export class MissionTaskAbsorb {
  constructor(private readonly deps: MissionTaskAbsorbDeps) {}

  /** Caller holds the Mission run lock; the restack afterwards runs inside it too. */
  async absorbRepo(
    mission: Mission,
    repoId: string,
    overrides: Record<string, string> = {}
  ): Promise<MissionAbsorbResult> {
    const repo = this.deps.store.getRepo(repoId)
    const stack = getRepoTaskStack(mission, repoId)
    const previewId = getMissionSlotRecord(mission, repoId, 'preview')?.worktreeId
    const previewPath = previewId ? splitWorktreeId(previewId)?.worktreePath : undefined
    if (!repo || stack.length === 0 || !previewId || !previewPath) {
      throw new Error('mission_task_not_found')
    }
    // Why: blame only names the right layer when every layer sits on its parent and the preview on the top.
    const report = await this.deps.restacker.inspectRepo(mission, repoId)
    if (report.layers.some((layer) => layer.slot !== 'member' && layer.state !== 'current')) {
      throw new Error(LAYERS_BUSY)
    }
    const layers = await this.readLayers(mission, repo.path, stack)
    const previewHead = layers.at(-1)?.tip ?? ''
    const edits = toAbsorbHunks(await readPreviewEdits(previewPath))
    if (edits.hunks.size === 0) {
      return { applied: 0, ambiguous: [] }
    }
    const plan = planAbsorb(
      [...edits.hunks.keys()],
      await this.blameTouchedLines(previewPath, edits),
      layers.map(({ task, commits }) => ({ taskId: task.id, commits })),
      stack.at(-1)?.id ?? '',
      new Map(Object.entries(overrides))
    )
    if (plan.ambiguous.length > 0) {
      const ambiguous = plan.ambiguous.map(({ hunk, candidateTaskIds }) => ({
        file: hunk.file,
        line: getAbsorbHunkLine(hunk),
        candidateTaskIds
      }))
      return { applied: 0, ambiguous }
    }
    const lowest = Math.min(
      ...plan.assignments.map(({ taskId }) => layers.findIndex(({ task }) => task.id === taskId))
    )
    const involved = layers.slice(lowest)
    await this.requireIdle(involved, previewId, previewPath, previewHead)
    const writes = await buildLayerWrites(
      involved,
      plan.assignments,
      edits,
      previewPath,
      previewHead
    )
    await writeLayersThenRevertPreview(writes, previewPath, edits.files)
    await removeAbsorbedUntrackedFiles(previewPath, edits.files)
    // Why: the preview was verified on this tip, so restack may move it although the top was rewritten.
    const followed =
      this.deps.store.setMissionPreviewFollowedSha(mission.id, repoId, previewHead) ?? mission
    const restacked = await this.deps.restacker.restackRepo(followed, repoId)
    const unsettled = restacked.layers.filter(
      (layer) => layer.slot !== 'member' && layer.state !== 'current'
    )
    const applied = { applied: plan.assignments.length, ambiguous: [] }
    if (unsettled.length === 0) {
      return applied
    }
    const states = unsettled.map(({ slot, state }) => `${slot} ${state}`).join(', ')
    return { ...applied, warning: `Edits were absorbed, but the restack stopped: ${states}.` }
  }

  private async readLayers(mission: Mission, repoPath: string, stack: MissionTask[]) {
    const layers: AbsorbLayer[] = []
    for (const task of stack) {
      const worktreePath = task.worktreeId ? splitWorktreeId(task.worktreeId)?.worktreePath : null
      const parentTip = await getBranchTip(repoPath, getMissionTaskParentBranch(mission, task))
      const tip = await getBranchTip(repoPath, task.branchName)
      if (!task.worktreeId || !worktreePath || !parentTip || !tip) {
        throw new Error(LAYERS_BUSY)
      }
      const commits = await listLayerCommits(repoPath, parentTip, tip)
      layers.push({ task, worktreeId: task.worktreeId, worktreePath, parentTip, tip, commits })
    }
    return layers
  }

  private async blameTouchedLines(
    previewPath: string,
    edits: PreviewEdits
  ): Promise<Map<string, Map<number, string>>> {
    const files = new Set(
      [...edits.hunks.keys()].filter((hunk) => hunk.touchedOldLines.length > 0).map((h) => h.file)
    )
    const blameByFile = new Map<string, Map<number, string>>()
    for (const file of files) {
      // Why: a whitespace-only change belongs to the layer that made it, or its fixup would conflict.
      const blame = await getFileBlame(previewPath, file, {}, 'HEAD', undefined, {
        ignoreWhitespace: false
      })
      if (blame.status !== 'ready') {
        throw new Error('mission_absorb_blame_failed')
      }
      blameByFile.set(file, new Map(blame.lines.map((line) => [line.line, line.commitOid])))
    }
    return blameByFile
  }

  private async requireIdle(
    involved: AbsorbLayer[],
    previewId: string,
    previewPath: string,
    previewHead: string
  ): Promise<void> {
    const checks = [
      ...involved.map((layer) => ({
        id: layer.worktreeId,
        path: layer.worktreePath,
        tip: layer.tip,
        mustBeClean: true
      })),
      { id: previewId, path: previewPath, tip: previewHead, mustBeClean: false }
    ]
    for (const check of checks) {
      const snapshot = await readLayerWorktree(check.path)
      const idle =
        snapshot.operation === 'unknown' &&
        snapshot.headSha === check.tip &&
        (!check.mustBeClean || snapshot.isClean) &&
        !this.deps.isWorktreeAgentWorking(check.id)
      if (!idle) {
        throw new Error(LAYERS_BUSY)
      }
    }
  }
}
