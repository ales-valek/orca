import { DEV_ENV_NAME_PATTERN } from './dev-env-types'
import {
  INFRA_NAME_PATTERN,
  isIntegerInRange,
  isNonEmptyString,
  isRecord,
  mapValid
} from './dev-env-settings-values'
import type { DevContainerToolKind, DevTool } from './dev-tools-types'

const CONTAINER_KINDS: readonly DevContainerToolKind[] = [
  'adminer',
  'redisinsight',
  'bullmq-dashboard',
  's3-browser'
]

function isContainerKind(value: unknown): value is DevContainerToolKind {
  return CONTAINER_KINDS.some((kind) => kind === value)
}

export function normalizeDevTool(value: unknown): DevTool | null {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !DEV_ENV_NAME_PATTERN.test(value.name) ||
    !isNonEmptyString(value.label) ||
    typeof value.infraService !== 'string' ||
    !INFRA_NAME_PATTERN.test(value.infraService)
  ) {
    return null
  }
  const base = { name: value.name, label: value.label, infraService: value.infraService }
  if (isContainerKind(value.kind)) {
    // Why: ports below 1024 need privileges and would clash with the hostname proxy.
    return isIntegerInRange(value.port, 1024, 65535)
      ? {
          kind: value.kind,
          ...base,
          port: value.port,
          ...(isNonEmptyString(value.infraPortName) ? { infraPortName: value.infraPortName } : {})
        }
      : null
  }
  if (value.kind !== 'link' || !isNonEmptyString(value.portName)) {
    return null
  }
  if (value.path !== undefined && !(typeof value.path === 'string' && value.path.startsWith('/'))) {
    return null
  }
  return {
    kind: 'link',
    ...base,
    portName: value.portName,
    ...(typeof value.path === 'string' ? { path: value.path } : {})
  }
}

export function normalizeDevTools(value: unknown): DevTool[] {
  const tools = mapValid(value, normalizeDevTool)
  return tools.filter(
    (tool, index) => tools.findIndex((other) => other.name === tool.name) === index
  )
}
