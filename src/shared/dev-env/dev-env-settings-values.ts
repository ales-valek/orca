/** Shape checks for persisted Dev Environments settings, which arrive as unknown JSON. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function getStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function getStringRecord(value: unknown): Record<string, string> {
  const record: Record<string, string> = {}
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') {
        record[key] = entry
      }
    }
  }
  return record
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function mapValid<T>(value: unknown, normalize: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return []
  }
  const result: T[] = []
  for (const entry of value) {
    const normalized = normalize(entry)
    if (normalized !== null) {
      result.push(normalized)
    }
  }
  return result
}
