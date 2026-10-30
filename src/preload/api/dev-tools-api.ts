import type { DevToolView } from '../../shared/dev-env/dev-tools-types'

type ToolArgs = { name: string }

export type DevToolsApi = {
  list: () => Promise<DevToolView[]>
  open: (args: ToolArgs) => Promise<{ url: string } | { error: string }>
  stop: (args: ToolArgs) => Promise<void>
  restart: (args: ToolArgs) => Promise<{ url: string } | { error: string }>
  readLog: () => Promise<string>
}
