export type AbsorbHunk = {
  file: string
  patch: string
  /** Old-side line numbers the hunk modifies or deletes; empty for a pure addition or a new file. */
  touchedOldLines: number[]
  /** A binary, deleted, mode-only or submodule change: blame cannot place it. */
  opaque?: boolean
}

/** `commits` lists `parentBaseSha..tip` newest first; layers come bottom-up. */
export type AbsorbLayerRange = { taskId: string; commits: string[] }

export type AbsorbAssignment = { hunk: AbsorbHunk; taskId: string; fixupOf: string | null }

export type AbsorbPlan = {
  assignments: AbsorbAssignment[]
  ambiguous: { hunk: AbsorbHunk; candidateTaskIds: string[] }[]
}

/** Line a user names to place a hunk, e.g. in `--choose file:line=task`. */
export function getAbsorbHunkLine(hunk: AbsorbHunk): number {
  return hunk.touchedOldLines[0] ?? 0
}

export function getAbsorbHunkKey(hunk: AbsorbHunk): string {
  return `${hunk.file}:${getAbsorbHunkLine(hunk)}`
}

type CommitOwner = { taskId: string; rank: number }

/**
 * Places each preview hunk in the task layer whose commits own the lines it touches. Only layers
 * where `isPlaceable` holds are offered or chosen; an override naming any other layer throws.
 */
export function planAbsorb(
  hunks: AbsorbHunk[],
  blameByFile: Map<string, Map<number, string>>,
  layers: AbsorbLayerRange[],
  topTaskId: string,
  overrides = new Map<string, string>(),
  isPlaceable: (hunk: AbsorbHunk, taskId: string) => boolean = () => true
): AbsorbPlan {
  const ownerByCommit = new Map<string, CommitOwner>()
  for (const layer of layers) {
    layer.commits.forEach((commit, rank) =>
      ownerByCommit.set(commit, { taskId: layer.taskId, rank })
    )
  }
  const layerIds = layers.map((layer) => layer.taskId)
  const plan: AbsorbPlan = { assignments: [], ambiguous: [] }
  for (const hunk of hunks) {
    const blame = blameByFile.get(hunk.file)
    const commits = hunk.touchedOldLines.map((line) => blame?.get(line))
    const assign = (taskId: string): void => {
      plan.assignments.push({ hunk, taskId, fixupOf: getFixupTarget(taskId, commits) })
    }
    const placeable = layerIds.filter((id) => isPlaceable(hunk, id))
    const override = overrides.get(getAbsorbHunkKey(hunk))
    if (override && layerIds.includes(override)) {
      if (!placeable.includes(override)) {
        throw new Error(
          `mission_absorb_override_unplaceable: ${getAbsorbHunkKey(hunk)} cannot go into ${override} because layers above it changed those lines`
        )
      }
      assign(override)
      continue
    }
    // Why: an unblamed line has an unknown owner, which is not the same as no owner.
    if (hunk.opaque || commits.some((commit) => commit === undefined)) {
      plan.ambiguous.push({ hunk, candidateTaskIds: placeable })
      continue
    }
    const owners = new Set(
      commits.map((commit) => (commit && ownerByCommit.get(commit)?.taskId) ?? topTaskId)
    )
    if (owners.size === 0) {
      owners.add(topTaskId)
    }
    const placeableOwners = placeable.filter((id) => owners.has(id))
    if (placeableOwners.length === 1 && placeableOwners[0]) {
      assign(placeableOwners[0])
    } else {
      // Why: when no owner can take the hunk, any layer that can is a fair choice for the user.
      const candidateTaskIds = placeableOwners.length > 0 ? placeableOwners : placeable
      plan.ambiguous.push({ hunk, candidateTaskIds })
    }
  }
  return plan

  function getFixupTarget(taskId: string, commits: (string | undefined)[]): string | null {
    let newest: CommitOwner | null = null
    for (const commit of commits) {
      const owner = commit ? ownerByCommit.get(commit) : undefined
      if (owner?.taskId === taskId && (!newest || owner.rank < newest.rank)) {
        newest = owner
      }
    }
    const layer = layers.find((entry) => entry.taskId === taskId)
    return layer?.commits[newest?.rank ?? 0] ?? null
  }
}
