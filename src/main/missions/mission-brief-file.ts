import path from 'node:path'
import { MISSION_BRIEF_FILE_NAME } from '../../shared/mission-source'
import { assertOwnedMissionRoot } from './mission-root'
import { writeMissionRootMarkerFile } from './mission-root-marker-write'

/** Refuses to write unless the root is the exact directory Orca owns for this Mission. */
export function writeMissionBrief(
  root: { baseDir: string; rootPath: string; missionId: string },
  markdown: string
): void {
  assertOwnedMissionRoot(root)
  writeMissionRootMarkerFile(path.join(root.rootPath, MISSION_BRIEF_FILE_NAME), markdown)
}
