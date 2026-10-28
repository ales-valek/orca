import type { Mission, MissionSlotWorktree, MissionTask } from './mission-types'

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeMissionSlotWorktree(value: unknown): MissionSlotWorktree | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  // SAFETY: lenient hydration of persisted JSON; every field is re-validated below.
  // oxlint-disable-next-line typescript/consistent-type-assertions
  const raw = value as Partial<MissionSlotWorktree>
  if (typeof raw.repoId !== 'string' || raw.repoId.length === 0) {
    return null
  }
  const worktreeId = normalizeOptionalString(raw.worktreeId)
  return {
    repoId: raw.repoId,
    worktreeId,
    // Why: an instance stamp without its worktree id cannot identify ownership.
    worktreeInstanceId: worktreeId ? normalizeOptionalString(raw.worktreeInstanceId) : null,
    lastError:
      typeof raw.lastError === 'string' && raw.lastError.trim().length > 0
        ? raw.lastError.trim()
        : null
  }
}

function normalizeMissionPreviews(
  value: unknown,
  memberRepoIds: ReadonlySet<string>
): MissionSlotWorktree[] {
  if (!Array.isArray(value)) {
    return []
  }
  const previews: MissionSlotWorktree[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const preview = normalizeMissionSlotWorktree(candidate)
    if (!preview || !memberRepoIds.has(preview.repoId) || seen.has(preview.repoId)) {
      continue
    }
    seen.add(preview.repoId)
    previews.push(preview)
  }
  return previews
}

function normalizeMissionTasks(
  value: unknown,
  memberRepoIds: ReadonlySet<string>,
  now: number
): MissionTask[] {
  if (!Array.isArray(value)) {
    return []
  }
  const tasks: MissionTask[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    // SAFETY: lenient hydration of persisted JSON; every field is re-validated below.
    // oxlint-disable-next-line typescript/consistent-type-assertions
    const raw = candidate as Partial<MissionTask>
    const branchName = normalizeOptionalString(raw.branchName)
    if (
      typeof raw.id !== 'string' ||
      raw.id.length === 0 ||
      seen.has(raw.id) ||
      typeof raw.repoId !== 'string' ||
      !memberRepoIds.has(raw.repoId) ||
      !branchName ||
      typeof raw.order !== 'number' ||
      !Number.isInteger(raw.order) ||
      raw.order < 1
    ) {
      continue
    }
    seen.add(raw.id)
    const worktreeId = normalizeOptionalString(raw.worktreeId)
    tasks.push({
      id: raw.id,
      repoId: raw.repoId,
      order: raw.order,
      title: typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title : branchName,
      branchName,
      worktreeId,
      worktreeInstanceId: worktreeId ? normalizeOptionalString(raw.worktreeInstanceId) : null,
      parentBaseSha: normalizeOptionalString(raw.parentBaseSha),
      externalRef: normalizeOptionalString(raw.externalRef),
      externalId: normalizeOptionalString(raw.externalId),
      lastError:
        typeof raw.lastError === 'string' && raw.lastError.trim().length > 0
          ? raw.lastError.trim()
          : null,
      addedAt: typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : now
    })
  }
  return tasks
}

/** Optional stack fields stay absent for legacy missions so their shape is unchanged. */
export function normalizeMissionStackFields(
  raw: Partial<Mission>,
  memberRepoIds: ReadonlySet<string>,
  now: number
): Pick<Mission, 'tasks' | 'previews' | 'orchestratorRepoId' | 'orchestrator'> {
  const tasks = normalizeMissionTasks(raw.tasks, memberRepoIds, now)
  const previews = normalizeMissionPreviews(raw.previews, memberRepoIds)
  const rawOrchestratorRepoId = normalizeOptionalString(raw.orchestratorRepoId)
  // Why: an orchestrator repo that is also a member would get two worktrees on one branch.
  const orchestratorRepoId =
    rawOrchestratorRepoId && !memberRepoIds.has(rawOrchestratorRepoId)
      ? rawOrchestratorRepoId
      : null
  const orchestrator = normalizeMissionSlotWorktree(raw.orchestrator)
  return {
    ...(tasks.length > 0 ? { tasks } : {}),
    ...(previews.length > 0 ? { previews } : {}),
    ...(orchestratorRepoId ? { orchestratorRepoId } : {}),
    ...(orchestratorRepoId && orchestrator?.repoId === orchestratorRepoId ? { orchestrator } : {})
  }
}
