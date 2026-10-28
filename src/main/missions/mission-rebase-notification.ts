type WorktreeRebasedListener = (worktreePath: string) => void

let listener: WorktreeRebasedListener | null = null

/** Mission operations register here so git handlers need not know about Missions. */
export function setMissionWorktreeRebasedListener(next: WorktreeRebasedListener | null): void {
  listener = next
}

/** Call after a manual pull-rebase succeeded; never throws into the git operation. */
export function notifyMissionWorktreeRebased(worktreePath: string): void {
  try {
    listener?.(worktreePath)
  } catch (error) {
    console.error('[missions] rebase notification failed:', error)
  }
}
