import {
  DEV_ENV_STEP_IDS,
  type DevEnv,
  type DevEnvAttachment,
  type DevEnvBinding,
  type DevEnvSlotWorktree,
  type DevEnvStepState,
  type DevEnvStepStatus
} from './dev-env-types'

const STEP_STATUSES: readonly DevEnvStepStatus[] = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function normalizeAttachment(value: unknown): DevEnvAttachment | null {
  if (!isRecord(value)) {
    return null
  }
  if (value.kind === 'mission' && isNonEmptyString(value.missionId)) {
    return { kind: 'mission', missionId: value.missionId }
  }
  if (value.kind === 'worktree' && isNonEmptyString(value.worktreeId)) {
    return { kind: 'worktree', worktreeId: value.worktreeId }
  }
  return null
}

function normalizeSlotWorktree(value: unknown): DevEnvSlotWorktree | null {
  return isRecord(value) &&
    isNonEmptyString(value.worktreeId) &&
    isNonEmptyString(value.path) &&
    typeof value.label === 'string'
    ? { worktreeId: value.worktreeId, path: value.path, label: value.label }
    : null
}

function isStepStatus(value: unknown): value is DevEnvStepStatus {
  return STEP_STATUSES.some((status) => status === value)
}

function normalizeStep(value: unknown): DevEnvStepState | null {
  if (!isRecord(value) || !isStepStatus(value.status)) {
    return null
  }
  const step: DevEnvStepState = { status: value.status }
  if (typeof value.detail === 'string') {
    step.detail = value.detail
  }
  if (typeof value.error === 'string') {
    step.error = value.error
  }
  if (typeof value.startedAt === 'number') {
    step.startedAt = value.startedAt
  }
  if (typeof value.finishedAt === 'number') {
    step.finishedAt = value.finishedAt
  }
  // Why: nothing resumes a step after a restart; leaving it "running" would block every re-run.
  if (step.status === 'running') {
    return {
      ...step,
      status: 'failed',
      error: 'Interrupted: Orca quit while this step was running'
    }
  }
  return step
}

function normalizeDevEnv(value: unknown): DevEnv | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.key) ||
    !isNonEmptyString(value.templateId) ||
    typeof value.portSlot !== 'number' ||
    !Number.isInteger(value.portSlot) ||
    value.portSlot < 1 ||
    value.portSlot > 99
  ) {
    return null
  }
  const attachment = normalizeAttachment(value.attachment)
  if (!attachment) {
    return null
  }
  const slotPins: Record<string, string> = {}
  if (isRecord(value.slotPins)) {
    for (const [slot, worktreeId] of Object.entries(value.slotPins)) {
      if (isNonEmptyString(worktreeId)) {
        slotPins[slot] = worktreeId
      }
    }
  }
  const slotWorktrees: Record<string, DevEnvSlotWorktree | null> = {}
  if (isRecord(value.slotWorktrees)) {
    for (const [slot, entry] of Object.entries(value.slotWorktrees)) {
      slotWorktrees[slot] = normalizeSlotWorktree(entry)
    }
  }
  const bindings: Record<string, DevEnvBinding> = {}
  if (isRecord(value.bindings)) {
    for (const [dependency, entry] of Object.entries(value.bindings)) {
      if (isRecord(entry) && entry.kind === 'local' && isNonEmptyString(entry.devEnvId)) {
        bindings[dependency] = { kind: 'local', devEnvId: entry.devEnvId }
      }
    }
  }
  const setup: DevEnv['setup'] = {}
  if (isRecord(value.setup)) {
    for (const stepId of DEV_ENV_STEP_IDS) {
      const step = normalizeStep(value.setup[stepId])
      if (step) {
        setup[stepId] = step
      }
    }
  }
  const env: DevEnv = {
    id: value.id,
    key: value.key,
    name: typeof value.name === 'string' ? value.name : value.key,
    templateId: value.templateId,
    attachment,
    portSlot: value.portSlot,
    slotPins,
    slotWorktrees,
    bindings,
    setup,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0
  }
  if (value.detached === true) {
    env.detached = true
  }
  return env
}

export function normalizeDevEnvs(value: unknown): DevEnv[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    const env = normalizeDevEnv(entry)
    return env ? [env] : []
  })
}
