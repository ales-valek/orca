/** Tools Orca runs itself in the `orca-dev-tools` compose project, joined to the infra network. */
export type DevContainerToolKind = 'adminer' | 'redisinsight' | 'bullmq-dashboard'

export type DevContainerTool = {
  kind: DevContainerToolKind
  name: string
  label: string
  /** Host port on 127.0.0.1. */
  port: number
  /** Infra service the tool connects to; credentials come from its definition. */
  infraService: string
  /** Port of that service to use when it has several; the first port otherwise. */
  infraPortName?: string
}

/** An existing infra web UI, opened at the host port named `portName`. */
export type DevLinkTool = {
  kind: 'link'
  name: string
  label: string
  infraService: string
  portName: string
  path?: string
}

export type DevTool = DevContainerTool | DevLinkTool

export type DevToolState = 'running' | 'starting' | 'not-started' | 'infra-stopped' | 'unavailable'

export type DevToolView = {
  name: string
  label: string
  kind: DevTool['kind']
  state: DevToolState
  url: string | null
  detail?: string
}

export function isDevContainerTool(tool: DevTool): tool is DevContainerTool {
  return tool.kind !== 'link'
}
