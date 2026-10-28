import type { Mission } from './mission-types'
import { splitWorktreeId } from './worktree/id'

/** Folder the Mission's root session runs in: the recorded orchestrator worktree, else the root. */
export function getMissionSessionFolderPath(
  mission: Pick<Mission, 'rootPath' | 'orchestratorRepoId' | 'orchestrator'>
): string | null {
  if (!mission.rootPath) {
    return null
  }
  const orchestrator = mission.orchestrator
  if (orchestrator?.worktreeId && orchestrator.repoId === mission.orchestratorRepoId) {
    const parsed = splitWorktreeId(orchestrator.worktreeId)
    if (parsed?.repoId === orchestrator.repoId) {
      return parsed.worktreePath
    }
  }
  return mission.rootPath
}
