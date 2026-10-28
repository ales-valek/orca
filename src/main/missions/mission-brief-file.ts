import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Mission } from '../../shared/mission-types'
import { MISSION_BRIEF_FILE_NAME } from '../../shared/mission-source'
import { assertOwnedMissionRoot } from './mission-root'
import { writeMissionRootMarkerFile } from './mission-root-marker-write'
import { resolveMissionBaseDir } from './mission-root-sync'

/** Refuses to write unless the root is the exact directory Orca owns for this Mission. */
export function writeMissionBrief(
  root: { baseDir: string; rootPath: string; missionId: string },
  markdown: string
): void {
  assertOwnedMissionRoot(root)
  writeMissionRootMarkerFile(path.join(root.rootPath, MISSION_BRIEF_FILE_NAME), markdown)
}

/** Returns false without writing when the Mission root is not on disk. */
export function writeMissionBriefIfRooted(
  store: Parameters<typeof resolveMissionBaseDir>[0],
  mission: Mission,
  markdown: string
): boolean {
  if (!mission.rootPath || !existsSync(mission.rootPath)) {
    return false
  }
  writeMissionBrief(
    {
      baseDir: resolveMissionBaseDir(store, mission),
      rootPath: mission.rootPath,
      missionId: mission.id
    },
    markdown
  )
  return true
}
