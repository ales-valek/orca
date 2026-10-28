import { getAbsorbHunkLine, planAbsorb } from '../../shared/mission-absorb-plan'
import {
  getMissionPreviewBranch,
  getMissionTaskParentBranch,
  getRepoTaskStack
} from '../../shared/mission-task-stack'
import type { Mission, MissionAbsorbResult, MissionTask } from '../../shared/mission-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import { getFileBlame } from '../git/blame'
import {
  getBranchTip,
  getCommitAncestry,
  listLayerCommits,
  readLayerWorktree
} from '../git/stack-layer-git'
import {
  buildLayerWrites,
  getPlaceableTaskIds,
  LayerToPreviewDiffs,
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

export type { MissionAbsorbResult } from '../../shared/mission-types'

export type MissionTaskAbsorbDeps = {
  store: MissionTaskRestackDeps['store']
  restacker: MissionTaskRestack
  isWorktreeAgentWorking: (worktreeId: string) => boolean
}

const LAYERS_BUSY = 'mission_absorb_layers_busy'
const STACK_STALE = 'mission_absorb_stack_stale'

/** A task layer as read before planning; its checkout matters only once absorb writes to it. */
type StackLayer = Omit<AbsorbLayer, 'worktreeId' | 'worktreePath'> & {
  worktreeId: string | null
  worktreePath: string | null
}

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
    const layers = await this.readStack(mission, repo.path, stack)
    const previewHead = layers.at(-1)?.tip ?? ''
    if ((await readLayerWorktree(previewPath)).headSha !== previewHead) {
      throw new Error(STACK_STALE)
    }
    const edits = toAbsorbHunks(await readPreviewEdits(previewPath))
    if (edits.hunks.size === 0) {
      return { applied: 0, ambiguous: [] }
    }
    const diffs = new LayerToPreviewDiffs(previewPath, previewHead)
    const placeable = await getPlaceableTaskIds(
      layers.map(({ task, tip }) => ({ taskId: task.id, tip })),
      edits,
      diffs
    )
    const plan = planAbsorb(
      [...edits.hunks.keys()],
      await this.blameTouchedLines(previewPath, edits),
      layers.map(({ task, commits }) => ({ taskId: task.id, commits })),
      stack.at(-1)?.id ?? '',
      new Map(Object.entries(overrides)),
      (hunk, taskId) => placeable.get(hunk)?.has(taskId) ?? false
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
    const involved = await this.requireIdle(layers.slice(lowest), {
      id: previewId,
      path: previewPath,
      branch: getMissionPreviewBranch(mission),
      tip: previewHead
    })
    const writes = await buildLayerWrites(involved, plan.assignments, edits, diffs)
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

  /** Branch tips and ranges; throws when a layer no longer sits on its parent's tip. */
  private async readStack(mission: Mission, repoPath: string, stack: MissionTask[]) {
    const layers: StackLayer[] = []
    for (const task of stack) {
      const parentTip = await getBranchTip(repoPath, getMissionTaskParentBranch(mission, task))
      const tip = await getBranchTip(repoPath, task.branchName)
      // Why: `rebase -i --autosquash parentTip` would move a layer that left its parent's history.
      if (
        !parentTip ||
        !tip ||
        task.parentBaseSha !== parentTip ||
        (await getCommitAncestry(repoPath, parentTip, tip)) !== true
      ) {
        throw new Error(STACK_STALE)
      }
      const worktreeId = task.worktreeId ?? null
      const worktreePath = worktreeId ? (splitWorktreeId(worktreeId)?.worktreePath ?? null) : null
      const commits = await listLayerCommits(repoPath, parentTip, tip)
      layers.push({ task, worktreeId, worktreePath, parentTip, tip, commits })
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

  /** Every layer absorb writes to, and the preview, must be on its tip, clean (layers) and idle. */
  private async requireIdle(
    involved: StackLayer[],
    preview: { id: string; path: string; branch: string; tip: string }
  ): Promise<AbsorbLayer[]> {
    const writable: AbsorbLayer[] = []
    for (const layer of involved) {
      const { worktreeId, worktreePath } = layer
      if (!worktreeId || !worktreePath) {
        throw new Error(LAYERS_BUSY)
      }
      const checkout = { id: worktreeId, path: worktreePath, tip: layer.tip }
      await this.requireIdleCheckout({ ...checkout, branch: layer.task.branchName }, true)
      writable.push({ ...layer, worktreeId, worktreePath })
    }
    await this.requireIdleCheckout(preview, false)
    return writable
  }

  private async requireIdleCheckout(
    checkout: { id: string; path: string; branch: string; tip: string },
    mustBeClean: boolean
  ): Promise<void> {
    const snapshot = await readLayerWorktree(checkout.path)
    const idle =
      snapshot.operation === 'unknown' &&
      snapshot.branch === checkout.branch &&
      snapshot.headSha === checkout.tip &&
      (!mustBeClean || snapshot.isClean) &&
      !this.deps.isWorktreeAgentWorking(checkout.id)
    if (!idle) {
      throw new Error(LAYERS_BUSY)
    }
  }
}
