import type { Mission } from './mission-types'
import { getFolderWorkspaceOwnerEnv } from './missions'
import { getMissionBriefPath } from './mission-source'

/** Owner env for a folder workspace, reading its Mission's root and brief when it has one. */
export function getFolderWorkspaceOwnerEnvWithMission(
  workspace: { projectGroupId: string; missionId?: string | null },
  getMission: (missionId: string) => Pick<Mission, 'rootPath' | 'source'> | null | undefined
): Record<string, string> {
  const mission = workspace.missionId ? getMission(workspace.missionId) : undefined
  return getFolderWorkspaceOwnerEnv({
    ...workspace,
    missionRootPath: mission?.rootPath,
    missionBriefPath: mission ? getMissionBriefPath(mission) : null
  })
}
