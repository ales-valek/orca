import type {
  DevEnvCredential,
  DevEnvEnvFile,
  DevEnvEnvLine,
  DevEnvInfraPort,
  DevEnvInfraService,
  DevEnvRemoteTier,
  DevEnvServiceDef,
  DevEnvTemplate,
  DevEnvTemplateSlot
} from './dev-env-types'

export type DevEnvGlobalSettings = {
  devEnvInfra: DevEnvInfraService[]
  devEnvRemoteTiers: DevEnvRemoteTier[]
  devEnvTemplates: DevEnvTemplate[]
  /** Fixed port of the Dev Environments hostname proxy. */
  devEnvProxyPort: number
}

export function getDefaultDevEnvProxyPort(platform: NodeJS.Platform): number {
  // Why: unprivileged processes can bind :80 on macOS and Windows but not on Linux.
  return platform === 'linux' ? 8080 : 80
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function getStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function getStringRecord(value: unknown): Record<string, string> {
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

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function mapValid<T>(value: unknown, normalize: (entry: unknown) => T | null): T[] {
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

function normalizeInfraPort(value: unknown): DevEnvInfraPort | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    !isIntegerInRange(value.host, 1, 65535) ||
    !isIntegerInRange(value.container, 1, 65535)
  ) {
    return null
  }
  return { name: value.name, host: value.host, container: value.container }
}

// Why: the name becomes a compose service and a snapshot file name.
const INFRA_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

function normalizeInfraService(value: unknown): DevEnvInfraService | null {
  if (!isRecord(value) || !isNonEmptyString(value.name) || !INFRA_NAME_PATTERN.test(value.name)) {
    return null
  }
  const service: DevEnvInfraService = {
    name: value.name,
    ports: mapValid(value.ports, normalizeInfraPort),
    environment: getStringRecord(value.environment),
    volumes: getStrings(value.volumes)
  }
  if (isNonEmptyString(value.image)) {
    service.image = value.image
  }
  if (isRecord(value.build) && isNonEmptyString(value.build.context)) {
    service.build = { context: value.build.context }
    if (isNonEmptyString(value.build.dockerfile)) {
      service.build.dockerfile = value.build.dockerfile
    }
  }
  if (Array.isArray(value.command)) {
    service.command = getStrings(value.command)
  }
  if (isRecord(value.healthcheck) && Array.isArray(value.healthcheck.test)) {
    service.healthcheck = { test: getStrings(value.healthcheck.test) }
    if (isIntegerInRange(value.healthcheck.intervalSec, 1, 3600)) {
      service.healthcheck.intervalSec = value.healthcheck.intervalSec
    }
    if (isIntegerInRange(value.healthcheck.retries, 1, 1000)) {
      service.healthcheck.retries = value.healthcheck.retries
    }
  }
  if (
    isRecord(value.resource) &&
    typeof value.resource.create === 'string' &&
    typeof value.resource.drop === 'string'
  ) {
    service.resource = { create: value.resource.create, drop: value.resource.drop }
    if (typeof value.resource.dump === 'string' && typeof value.resource.restore === 'string') {
      service.resource.dump = value.resource.dump
      service.resource.restore = value.resource.restore
    }
  }
  return service
}

function normalizeEnvLine(value: unknown): DevEnvEnvLine | null {
  return isRecord(value) && isNonEmptyString(value.key) && typeof value.value === 'string'
    ? { key: value.key, value: value.value }
    : null
}

function normalizeEnvFile(value: unknown): DevEnvEnvFile | null {
  if (!isRecord(value) || !isNonEmptyString(value.path)) {
    return null
  }
  const file: DevEnvEnvFile = { path: value.path, lines: mapValid(value.lines, normalizeEnvLine) }
  if (isNonEmptyString(value.base)) {
    file.base = value.base
  }
  if (isNonEmptyString(value.valuesFile)) {
    file.valuesFile = value.valuesFile
  }
  return file
}

function normalizeService(value: unknown): DevEnvServiceDef | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.name) ||
    typeof value.command !== 'string' ||
    !isIntegerInRange(value.portOffset, 0, 99)
  ) {
    return null
  }
  const service: DevEnvServiceDef = {
    name: value.name,
    command: value.command,
    portOffset: value.portOffset,
    dependsOn: getStrings(value.dependsOn)
  }
  if (isNonEmptyString(value.host)) {
    service.host = value.host
  }
  if (isRecord(value.ready)) {
    service.ready = isNonEmptyString(value.ready.httpPath) ? { httpPath: value.ready.httpPath } : {}
  }
  if (isRecord(value.exports)) {
    service.exports = getStringRecord(value.exports)
  }
  if (isRecord(value.prod) && isNonEmptyString(value.prod.start)) {
    service.prod = isNonEmptyString(value.prod.build)
      ? { build: value.prod.build, start: value.prod.start }
      : { start: value.prod.start }
  }
  return service
}

function normalizeSlot(value: unknown): DevEnvTemplateSlot | null {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return null
  }
  return {
    name: value.name,
    repoId: isNonEmptyString(value.repoId) ? value.repoId : null,
    install: getStrings(value.install),
    envFiles: mapValid(value.envFiles, normalizeEnvFile),
    services: mapValid(value.services, normalizeService)
  }
}

function normalizeCredential(value: unknown): DevEnvCredential | null {
  return isRecord(value) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.userKey) &&
    isNonEmptyString(value.passwordKey)
    ? { label: value.label, userKey: value.userKey, passwordKey: value.passwordKey }
    : null
}

function normalizeTemplate(value: unknown): DevEnvTemplate | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) {
    return null
  }
  const template: DevEnvTemplate = {
    id: value.id,
    name: value.name,
    slots: mapValid(value.slots, normalizeSlot),
    dependencies: getStrings(value.dependencies),
    credentials: mapValid(value.credentials, normalizeCredential)
  }
  const seed = value.seed
  if (isRecord(seed) && isNonEmptyString(seed.slot) && isNonEmptyString(seed.command)) {
    template.seed = {
      slot: seed.slot,
      command: seed.command,
      enabledByDefault: seed.enabledByDefault === true
    }
  }
  return template
}

function normalizeRemoteTier(value: unknown): DevEnvRemoteTier | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.name)) {
    return null
  }
  const dependencies: DevEnvRemoteTier['dependencies'] = {}
  if (isRecord(value.dependencies)) {
    for (const [name, entry] of Object.entries(value.dependencies)) {
      if (isRecord(entry) && isNonEmptyString(entry.url)) {
        dependencies[name] = { url: entry.url, values: getStringRecord(entry.values) }
      }
    }
  }
  return { id: value.id, name: value.name, danger: value.danger === true, dependencies }
}

function getDuplicateServiceName(template: DevEnvTemplate): string | null {
  const seen = new Set<string>()
  for (const slot of template.slots) {
    for (const service of slot.services) {
      if (seen.has(service.name)) {
        return service.name
      }
      seen.add(service.name)
    }
  }
  return null
}

function normalizeTemplates(value: unknown): DevEnvTemplate[] {
  return mapValid(value, normalizeTemplate).filter(
    (template) => getDuplicateServiceName(template) === null
  )
}

function normalizeProxyPort(value: unknown, platform: NodeJS.Platform): number {
  return isIntegerInRange(value, 1, 65535) ? value : getDefaultDevEnvProxyPort(platform)
}

export function normalizeDevEnvSettings(
  value: unknown,
  platform: NodeJS.Platform
): DevEnvGlobalSettings {
  const settings = isRecord(value) ? value : {}
  return {
    devEnvInfra: mapValid(settings.devEnvInfra, normalizeInfraService),
    devEnvRemoteTiers: mapValid(settings.devEnvRemoteTiers, normalizeRemoteTier),
    devEnvTemplates: normalizeTemplates(settings.devEnvTemplates),
    devEnvProxyPort: normalizeProxyPort(settings.devEnvProxyPort, platform)
  }
}

export function normalizeDevEnvSettingsUpdate(
  updates: Partial<DevEnvGlobalSettings>
): Partial<DevEnvGlobalSettings> {
  const normalized: Partial<DevEnvGlobalSettings> = {}
  if ('devEnvInfra' in updates) {
    normalized.devEnvInfra = mapValid(updates.devEnvInfra, normalizeInfraService)
  }
  if ('devEnvRemoteTiers' in updates) {
    normalized.devEnvRemoteTiers = mapValid(updates.devEnvRemoteTiers, normalizeRemoteTier)
  }
  if ('devEnvTemplates' in updates) {
    normalized.devEnvTemplates = normalizeTemplates(updates.devEnvTemplates)
  }
  if ('devEnvProxyPort' in updates && isIntegerInRange(updates.devEnvProxyPort, 1, 65535)) {
    normalized.devEnvProxyPort = updates.devEnvProxyPort
  }
  return normalized
}

export function parseDevEnvTemplateJson(
  text: string
): { template: DevEnvTemplate } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  const template = normalizeTemplate(parsed)
  if (!template) {
    return { error: 'Not a Dev Environment template' }
  }
  const duplicate = getDuplicateServiceName(template)
  return duplicate === null ? { template } : { error: `Duplicate service name "${duplicate}"` }
}

export function serializeDevEnvTemplate(template: DevEnvTemplate): string {
  return `${JSON.stringify(template, null, 2)}\n`
}
