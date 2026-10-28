import {
  deriveMissionLayerState,
  getMissionLayerBlockedReason,
  type MissionLayerState,
  type MissionLayerStateInput,
  type MissionRestackLayer,
  type MissionRestackReport
} from '../../shared/mission-layer-state'
import {
  getMissionPreviewBranch,
  getMissionTaskParentBranch,
  getRepoTaskStack,
  getTopMissionTask
} from '../../shared/mission-task-stack'
import type { Mission, MissionSlot, MissionTask } from '../../shared/mission-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence'
import {
  getBranchTip,
  getForkPoint,
  isAncestorCommit,
  readLayerWorktree,
  rebaseLayerOnto,
  resetPreviewKeep,
  type LayerWorktreeSnapshot
} from '../git/stack-layer-git'
import { getMissionSlotRecord } from './mission-worktree-ownership'

export type MissionTaskRestackDeps = {
  store: Pick<Store, 'getRepo' | 'setMissionTaskParentBaseSha' | 'flushPendingOrThrowAsync'>
  isWorktreeAgentWorking: (worktreeId: string) => boolean
  /** Defaults to `getBranchTip`; tests use it to move a branch between the read and the write. */
  readBranchTip?: typeof getBranchTip
}

type LayerSpec = {
  slot: MissionSlot
  worktreeId: string | null | undefined
  /** Branch the checkout must be on; anything else is never rewritten. */
  branch: string
  parentTip: string | null
  getParentBaseSha: (snapshot: LayerWorktreeSnapshot) => string | null
  /** The preview only moves with `reset --keep`, which itself refuses edits it would overwrite. */
  ignoresLocalEdits?: boolean
}

type LayerReading = {
  slot: MissionSlot
  state: MissionLayerState
  reason?: string
  worktreePath?: string
  parentTip?: string | null
  parentBaseSha?: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toReportLayer({ slot, state, reason }: LayerReading): MissionRestackLayer {
  return reason ? { slot, state, reason } : { slot, state }
}

/** Keeps each task layer based on its parent's current tip, bottom-up, and the preview on the top task. */
export class MissionTaskRestack {
  private readonly readBranchTip: typeof getBranchTip

  constructor(private readonly deps: MissionTaskRestackDeps) {
    this.readBranchTip = deps.readBranchTip ?? getBranchTip
  }

  /** Every layer's state without any git or store write. */
  inspectRepo(mission: Mission, repoId: string): Promise<MissionRestackReport> {
    return this.walk(mission, repoId, false)
  }

  /** Caller holds the Mission run lock; each git write also takes the worktree operation lock. */
  restackRepo(mission: Mission, repoId: string): Promise<MissionRestackReport> {
    return this.walk(mission, repoId, true)
  }

  private async walk(
    mission: Mission,
    repoId: string,
    write: boolean
  ): Promise<MissionRestackReport> {
    const layers: MissionRestackLayer[] = []
    const member = mission.members.find((entry) => entry.repoId === repoId)
    const repo = this.deps.store.getRepo(repoId)
    if (!member || !repo) {
      return { repoId, layers }
    }
    const memberReading = await this.readLayer({
      slot: 'member',
      worktreeId: member.worktreeId,
      branch: mission.branchName,
      parentTip: null,
      getParentBaseSha: () => null
    })
    layers.push(toReportLayer(memberReading))
    const top = getTopMissionTask(mission, repoId)
    // Why: the preview may follow either the top tip this run produces or the one it started from.
    const initialTopTip = top ? await this.readBranchTip(repo.path, top.branchName) : null
    // Why: once a layer cannot move, rebasing the ones above would stack them on a stale parent.
    let writable = write
    for (const task of getRepoTaskStack(mission, repoId)) {
      let reading = await this.readTask(mission, repo.path, task, task.parentBaseSha)
      if (writable && reading.state === 'stale') {
        reading = await this.rebaseTask(mission, repo.path, task, reading)
      }
      layers.push(toReportLayer(reading))
      if (reading.state === 'blocked' || reading.state === 'conflict') {
        writable = false
      }
    }
    if (top) {
      const preview = await this.followTopTask(mission, repoId, repo.path, top, {
        writable,
        initialTopTip
      })
      layers.push(toReportLayer(preview))
    }
    return { repoId, layers }
  }

  private async readTask(
    mission: Mission,
    repoPath: string,
    task: MissionTask,
    parentBaseSha: string | null
  ): Promise<LayerReading> {
    return this.readLayer({
      slot: `task:${task.id}`,
      worktreeId: task.worktreeId,
      branch: task.branchName,
      parentTip: await this.readBranchTip(repoPath, getMissionTaskParentBranch(mission, task)),
      getParentBaseSha: () => parentBaseSha
    })
  }

  private async rebaseTask(
    mission: Mission,
    repoPath: string,
    task: MissionTask,
    reading: LayerReading
  ): Promise<LayerReading> {
    const { worktreePath, parentTip, parentBaseSha } = reading
    if (!worktreePath || !parentTip || !parentBaseSha) {
      return reading
    }
    // Why: a layer already on the parent tip (rebased by hand or after a resolved conflict) only needs its base recorded.
    if (!(await isAncestorCommit(worktreePath, parentTip, 'HEAD'))) {
      const parentBranch = getMissionTaskParentBranch(mission, task)
      const base = await this.findReplayBase(worktreePath, parentBranch, parentBaseSha)
      if (!base) {
        return {
          ...reading,
          state: 'blocked',
          reason: 'Recorded base is not an ancestor of the layer'
        }
      }
      try {
        const result = await rebaseLayerOnto(worktreePath, parentTip, base)
        if (result.status === 'conflict') {
          return { ...reading, state: 'conflict' }
        }
      } catch (error) {
        return { ...reading, state: 'blocked', reason: toErrorMessage(error) }
      }
    }
    this.deps.store.setMissionTaskParentBaseSha(mission.id, task.id, parentTip)
    // Why: a lost base after a crash would make the next restack replay parent commits.
    await this.deps.store.flushPendingOrThrowAsync()
    // Why: a parent that moved during the rebase must read stale again, never current.
    return this.readTask(mission, repoPath, task, parentTip)
  }

  /** Newest commit below the layer's own commits that belonged to the parent; null when the record is unusable. */
  private async findReplayBase(
    worktreePath: string,
    parentBranch: string,
    recorded: string
  ): Promise<string | null> {
    if (!(await isAncestorCommit(worktreePath, recorded, 'HEAD'))) {
      return null
    }
    // Why: a conflict resolved outside restack leaves the layer on an unrecorded parent tip; the parent's reflog still knows it.
    const forkPoint = await getForkPoint(worktreePath, parentBranch)
    return forkPoint && (await isAncestorCommit(worktreePath, recorded, forkPoint))
      ? forkPoint
      : recorded
  }

  private async followTopTask(
    mission: Mission,
    repoId: string,
    repoPath: string,
    top: MissionTask,
    run: { writable: boolean; initialTopTip: string | null }
  ): Promise<LayerReading> {
    const readPreview = async (): Promise<LayerReading> =>
      this.readLayer({
        slot: 'preview',
        worktreeId: getMissionSlotRecord(mission, repoId, 'preview')?.worktreeId,
        branch: getMissionPreviewBranch(mission),
        parentTip: await this.readBranchTip(repoPath, top.branchName),
        // Why: the preview has no own commits, so its HEAD is the top-task tip it last followed.
        getParentBaseSha: (snapshot) => snapshot.headSha,
        ignoresLocalEdits: true
      })
    const reading = await readPreview()
    const { worktreePath, parentTip, parentBaseSha: head } = reading
    if (reading.state !== 'stale' || !worktreePath || !parentTip || !head) {
      return reading
    }
    const followsTop =
      (await isAncestorCommit(worktreePath, head, parentTip)) ||
      (run.initialTopTip !== null &&
        (await isAncestorCommit(worktreePath, head, run.initialTopTip)))
    if (!followsTop) {
      return { ...reading, state: 'blocked', reason: 'Preview has its own commits' }
    }
    if (!run.writable) {
      return reading
    }
    try {
      const reset = await resetPreviewKeep(worktreePath, parentTip)
      if (reset.status === 'blocked') {
        return { ...reading, state: 'blocked', reason: reset.reason }
      }
    } catch (error) {
      return { ...reading, state: 'blocked', reason: toErrorMessage(error) }
    }
    return readPreview()
  }

  private async readLayer(spec: LayerSpec): Promise<LayerReading> {
    const { slot, worktreeId } = spec
    const worktreePath = worktreeId ? splitWorktreeId(worktreeId)?.worktreePath : undefined
    if (!worktreeId || !worktreePath) {
      return { slot, state: 'blocked', reason: 'The layer has no worktree' }
    }
    let snapshot: LayerWorktreeSnapshot
    try {
      snapshot = await readLayerWorktree(worktreePath)
    } catch (error) {
      return { slot, state: 'blocked', reason: toErrorMessage(error) }
    }
    const conflict = snapshot.operation !== 'unknown'
    if (!conflict && snapshot.branch !== spec.branch) {
      const actual = snapshot.branch ?? 'a detached HEAD'
      return { slot, state: 'blocked', reason: `Checkout is on ${actual}, not ${spec.branch}` }
    }
    const parentBaseSha = spec.getParentBaseSha(snapshot)
    const input: MissionLayerStateInput = {
      parentTip: spec.parentTip,
      parentBaseSha,
      isClean: spec.ignoresLocalEdits === true || snapshot.isClean,
      isAgentWorking: this.deps.isWorktreeAgentWorking(worktreeId),
      conflict,
      // Why: PR facts are not known here; hosted-review callers layer them on later.
      prMerged: false,
      localTip: snapshot.headSha,
      pushedTip: null,
      hasOpenPr: false
    }
    const state = deriveMissionLayerState(input)
    const reason = getMissionLayerBlockedReason(input) ?? undefined
    return { slot, state, reason, worktreePath, parentTip: spec.parentTip, parentBaseSha }
  }
}
