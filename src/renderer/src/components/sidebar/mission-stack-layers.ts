import { getMissionPreviewBranch, getRepoTaskStack } from '../../../../shared/mission-task-stack'
import type { Mission, MissionSlot, MissionTask } from '../../../../shared/mission-types'
import type { Worktree } from '../../../../shared/worktree/types'

/** Persisted pointer to a Mission slot's checkout. */
export type MissionSlotRecord = {
  worktreeId: string | null
  worktreeInstanceId?: string | null
  lastError?: string | null
}

export type MissionStackLayerView = {
  slot: Exclude<MissionSlot, 'member' | 'orchestrator'>
  title: string
  branch: string
  record: MissionSlotRecord | null
  /** Set on task layers; only the top task can be removed. */
  task?: MissionTask
  isTopTask: boolean
}

/** Tracker key and title, e.g. `OMP-951 Checkout`; the title alone without a key. */
export function getMissionTaskLabel(task: Pick<MissionTask, 'externalRef' | 'title'>): string {
  return task.externalRef ? `${task.externalRef} ${task.title}` : task.title
}

/** Layers above the member, bottom-up: each task, then the preview. */
export function getMissionStackLayers(
  mission: Mission,
  repoId: string,
  previewTitle: string
): MissionStackLayerView[] {
  const tasks = getRepoTaskStack(mission, repoId)
  if (tasks.length === 0) {
    return []
  }
  const preview = mission.previews?.find((entry) => entry.repoId === repoId) ?? null
  return [
    ...tasks.map((task, index) => ({
      slot: `task:${task.id}` as const,
      title: getMissionTaskLabel(task),
      branch: task.branchName,
      record: task,
      task,
      isTopTask: index === tasks.length - 1
    })),
    {
      slot: 'preview',
      title: previewTitle,
      branch: getMissionPreviewBranch(mission),
      record: preview,
      isTopTask: false
    }
  ]
}

/** The live checkout of a slot, or undefined when the listed worktree is not the one Mission created. */
export function resolveMissionSlotWorktree(
  candidate: Worktree | undefined,
  record: MissionSlotRecord,
  repoId: string,
  expectedBranch: string
): Worktree | undefined {
  if (!candidate || candidate.repoId !== repoId || !record.worktreeInstanceId) {
    return undefined
  }
  if (candidate.instanceId !== record.worktreeInstanceId) {
    return undefined
  }
  const branch = candidate.branch.replace(/^refs\/heads\//, '')
  // Why: a rebase/bisect detaches HEAD (empty branch) on the same verified checkout;
  // only a different branch means the checkout was repurposed.
  return branch === expectedBranch || branch === '' ? candidate : undefined
}
