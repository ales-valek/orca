import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { getRepoIdFromWorktreeId, splitWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence/loading-store/store'

const RESTACK_DEBOUNCE_MS = 2_000

export type MissionRestackTriggerDeps = {
  store: Pick<Store, 'getMissions' | 'getMission' | 'getWorktreeMeta'>
  restack: (input: { missionId: string; repoId: string }) => Promise<unknown>
  debounceMs?: number
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Debounced, fire-and-forget restacks started by events inside a Mission's member or task worktrees. */
export class MissionRestackTrigger {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly deps: MissionRestackTriggerDeps) {}

  /** An agent in this worktree finished or went idle; its commits may have moved a layer. */
  onAgentTurnEnded(worktreeId: string): void {
    this.scheduleForWorktree(worktreeId)
  }

  /** A manual pull-rebase moved the mission branch under a member worktree. */
  onWorktreeRebased(worktreePath: string): void {
    const target = normalizeRuntimePathForComparison(worktreePath)
    for (const mission of this.deps.store.getMissions()) {
      for (const member of mission.members) {
        const memberPath = member.worktreeId
          ? splitWorktreeId(member.worktreeId)?.worktreePath
          : null
        if (
          member.worktreeId &&
          memberPath &&
          normalizeRuntimePathForComparison(memberPath) === target
        ) {
          this.scheduleForWorktree(member.worktreeId)
          return
        }
      }
    }
  }

  private scheduleForWorktree(worktreeId: string): void {
    const meta = this.deps.store.getWorktreeMeta(worktreeId)
    const slot = meta?.missionSlot ?? 'member'
    if (!meta?.missionId || !(slot === 'member' || slot.startsWith('task:'))) {
      return
    }
    this.scheduleFor(meta.missionId, getRepoIdFromWorktreeId(worktreeId))
  }

  private scheduleFor(missionId: string, repoId: string): void {
    const mission = this.deps.store.getMission(missionId)
    if (!mission?.members.some((member) => member.repoId === repoId)) {
      return
    }
    const key = `${missionId}\0${repoId}`
    clearTimeout(this.timers.get(key))
    const timer = setTimeout(() => {
      this.timers.delete(key)
      void this.deps.restack({ missionId, repoId }).catch((error: unknown) => {
        console.error('[missions] automatic restack failed:', toErrorMessage(error))
      })
    }, this.deps.debounceMs ?? RESTACK_DEBOUNCE_MS)
    timer.unref?.()
    this.timers.set(key, timer)
  }
}
