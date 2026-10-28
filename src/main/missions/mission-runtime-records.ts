import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getMissionSlotBranch, getRepoTaskStack } from '../../shared/mission-task-stack'
import type {
  Mission,
  RuntimeMissionLayerRecord,
  RuntimeMissionRecord,
  RuntimeMissionStackRecord
} from '../../shared/mission-types'
import type { Repo } from '../../shared/repo-types'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { splitWorktreeId } from '../../shared/worktree/id'
import { MISSION_ROOT_MARKER_NAME } from './mission-root'
import { getMissionSlotRecord } from './mission-worktree-ownership'

type RuntimeRecordSource = {
  getRepo: (repoId: string) => Pick<Repo, 'displayName'> | null | undefined
}

function toWorktreePath(worktreeId: string | null | undefined): string | null {
  return worktreeId ? (splitWorktreeId(worktreeId)?.worktreePath ?? null) : null
}

function toStackRecords(
  source: RuntimeRecordSource,
  mission: Mission
): RuntimeMissionStackRecord[] {
  return mission.members.flatMap((member) => {
    const tasks = getRepoTaskStack(mission, member.repoId)
    if (tasks.length === 0) {
      return []
    }
    const layers: RuntimeMissionLayerRecord[] = [
      {
        slot: 'member',
        title: null,
        externalRef: null,
        branch: mission.branchName,
        worktreePath: toWorktreePath(member.worktreeId)
      },
      ...tasks.map((task): RuntimeMissionLayerRecord => ({
        slot: `task:${task.id}`,
        title: task.title,
        externalRef: task.externalRef ?? null,
        branch: task.branchName,
        worktreePath: toWorktreePath(task.worktreeId)
      }))
    ]
    const previewBranch = getMissionSlotBranch(mission, member.repoId, 'preview')
    if (previewBranch) {
      layers.push({
        slot: 'preview',
        title: null,
        externalRef: null,
        branch: previewBranch,
        worktreePath: toWorktreePath(
          getMissionSlotRecord(mission, member.repoId, 'preview')?.worktreeId
        )
      })
    }
    return [
      {
        repoId: member.repoId,
        repoName: source.getRepo(member.repoId)?.displayName ?? null,
        layers
      }
    ]
  })
}

export function toRuntimeMissionRecord(
  source: RuntimeRecordSource,
  mission: Mission
): RuntimeMissionRecord {
  const stacks = toStackRecords(source, mission)
  return {
    id: mission.id,
    name: mission.name,
    branch: mission.branchName,
    rootPath: mission.rootPath ?? null,
    members: mission.members.map((member) => ({
      repoId: member.repoId,
      repoName: source.getRepo(member.repoId)?.displayName ?? null,
      worktreeId: member.worktreeId,
      worktreePath: toWorktreePath(member.worktreeId),
      branch: mission.branchName,
      ...(member.lastError ? { error: member.lastError } : {})
    })),
    ...(mission.orchestratorRepoId
      ? {
          orchestrator: {
            repoId: mission.orchestratorRepoId,
            worktreePath: toWorktreePath(mission.orchestrator?.worktreeId),
            branch: mission.branchName
          }
        }
      : {}),
    ...(stacks.length > 0 ? { stacks } : {})
  }
}

/** Resolve `id:<id>`, `name:<name>`, or a bare id/name to exactly one Mission. */
export function resolveMissionSelector(missions: readonly Mission[], selector: string): Mission {
  const trimmed = selector.trim()
  let candidates: Mission[]
  if (trimmed.startsWith('id:')) {
    const id = trimmed.slice(3)
    candidates = missions.filter((mission) => mission.id === id)
  } else if (trimmed.startsWith('name:')) {
    const name = trimmed.slice(5)
    candidates = missions.filter((mission) => mission.name === name)
  } else {
    const byId = missions.filter((mission) => mission.id === trimmed)
    candidates = byId.length > 0 ? byId : missions.filter((mission) => mission.name === trimmed)
  }
  if (candidates.length > 1) {
    throw new Error('selector_ambiguous')
  }
  if (candidates.length === 0) {
    throw new Error('selector_not_found')
  }
  return candidates[0]
}

function readMarkerMissionId(directory: string): string | null {
  const markerPath = path.join(directory, MISSION_ROOT_MARKER_NAME)
  try {
    if (!lstatSync(markerPath).isFile()) {
      return null
    }
    const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (parsed && typeof parsed === 'object' && 'missionId' in parsed) {
      return typeof parsed.missionId === 'string' ? parsed.missionId : null
    }
  } catch {
    // Missing or unreadable marker: keep walking up.
  }
  return null
}

function findMissionByRootMarker(missions: readonly Mission[], startPath: string): Mission | null {
  let directory = path.resolve(startPath)
  while (true) {
    const missionId = readMarkerMissionId(directory)
    const mission = missionId ? missions.find((entry) => entry.id === missionId) : undefined
    // Why: a marker alone is not ownership; the root must still be the one the Mission recorded.
    if (
      mission?.rootPath &&
      normalizeRuntimePathForComparison(mission.rootPath) ===
        normalizeRuntimePathForComparison(directory)
    ) {
      return mission
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      return null
    }
    directory = parent
  }
}

/** Mission whose root (via `.orca-mission-root.json`) or member worktree contains `targetPath`. */
export function findMissionForPath(
  missions: readonly Mission[],
  targetPath: string
): Mission | null {
  const byMarker = findMissionByRootMarker(missions, targetPath)
  if (byMarker) {
    return byMarker
  }
  let best: { mission: Mission; length: number } | null = null
  for (const mission of missions) {
    const containers = [
      mission.rootPath ?? null,
      ...mission.members.map((member) =>
        member.worktreeId ? (splitWorktreeId(member.worktreeId)?.worktreePath ?? null) : null
      )
    ]
    for (const container of containers) {
      if (
        container &&
        isPathInsideOrEqual(container, targetPath) &&
        container.length > (best?.length ?? -1)
      ) {
        best = { mission, length: container.length }
      }
    }
  }
  return best?.mission ?? null
}
