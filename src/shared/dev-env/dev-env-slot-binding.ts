import type { Mission } from '../mission-types'
import type { DevEnvSlotWorktree, DevEnvTemplate, DevEnvTemplateSlot } from './dev-env-types'

export type DevEnvWorktreeLookup = (
  worktreeId: string
) => { path: string; repoId: string; label: string } | null

function toSlotWorktree(
  lookup: DevEnvWorktreeLookup,
  worktreeId: string | null | undefined,
  label: (worktreeLabel: string) => string
): DevEnvSlotWorktree | null {
  const worktree = worktreeId ? lookup(worktreeId) : null
  return worktreeId && worktree
    ? { worktreeId, path: worktree.path, label: label(worktree.label) }
    : null
}

function resolveMissionSlot(
  mission: Mission,
  slot: DevEnvTemplateSlot,
  pin: string | undefined,
  lookup: DevEnvWorktreeLookup
): DevEnvSlotWorktree | null {
  if (!slot.repoId) {
    return null
  }
  const preview = mission.previews?.find((entry) => entry.repoId === slot.repoId)
  const member = mission.members.find((entry) => entry.repoId === slot.repoId)
  return (
    toSlotWorktree(lookup, pin, (label) => `${slot.name} · ${label}`) ??
    toSlotWorktree(lookup, preview?.worktreeId, () => `${slot.name} · preview`) ??
    toSlotWorktree(lookup, member?.worktreeId, () => `${slot.name} · mission branch`)
  )
}

/** Pin, then the repo's preview, then its member worktree; unbound when the repo is not in the mission. */
export function resolveMissionSlotWorktrees(
  mission: Mission,
  template: DevEnvTemplate,
  pins: Record<string, string>,
  lookup: DevEnvWorktreeLookup
): Record<string, DevEnvSlotWorktree | null> {
  return Object.fromEntries(
    template.slots.map((slot) => [
      slot.name,
      resolveMissionSlot(mission, slot, pins[slot.name], lookup)
    ])
  )
}

export function resolveStandaloneSlotWorktrees(
  worktree: { id: string; repoId: string; path: string; label: string },
  template: DevEnvTemplate
): Record<string, DevEnvSlotWorktree | null> {
  const ownSlot = template.slots.find((slot) => slot.repoId === worktree.repoId)
  return Object.fromEntries(
    template.slots.map((slot) => [
      slot.name,
      slot === ownSlot
        ? {
            worktreeId: worktree.id,
            path: worktree.path,
            label: `${slot.name} · ${worktree.label}`
          }
        : null
    ])
  )
}

export function getMovedDevEnvSlots(
  before: Record<string, DevEnvSlotWorktree | null>,
  after: Record<string, DevEnvSlotWorktree | null>
): string[] {
  return Object.keys(after).filter(
    (slot) => (before[slot]?.worktreeId ?? null) !== (after[slot]?.worktreeId ?? null)
  )
}

/** Declared dependencies plus the services of slots that have no worktree. */
export function getRequiredDevEnvDependencies(
  template: DevEnvTemplate,
  slotWorktrees: Record<string, DevEnvSlotWorktree | null>
): string[] {
  const required = new Set(template.dependencies)
  for (const slot of template.slots) {
    if (!slotWorktrees[slot.name]) {
      for (const service of slot.services) {
        required.add(service.name)
      }
    }
  }
  return [...required].sort()
}
