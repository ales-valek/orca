const DEV_ENV_PORT_BASE = 20000
const DEV_ENV_PORT_BLOCK = 100
export const DEV_ENV_MAX_PORT_SLOT = 99

export function getDevEnvPort(portSlot: number, offset: number): number {
  return DEV_ENV_PORT_BASE + portSlot * DEV_ENV_PORT_BLOCK + offset
}

export function getDevEnvPortRange(portSlot: number): { first: number; last: number } {
  return {
    first: getDevEnvPort(portSlot, 0),
    last: getDevEnvPort(portSlot, DEV_ENV_PORT_BLOCK - 1)
  }
}

/** Lowest slot in 1..99 that no environment uses and whose ports are free. */
export function chooseDevEnvPortSlot(
  usedSlots: ReadonlySet<number>,
  isBlockFree: (slot: number) => boolean
): number | null {
  for (let slot = 1; slot <= DEV_ENV_MAX_PORT_SLOT; slot++) {
    if (!usedSlots.has(slot) && isBlockFree(slot)) {
      return slot
    }
  }
  return null
}
