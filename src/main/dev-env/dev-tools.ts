import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import type { DevEnvInfraService, DevEnvInfraState } from '../../shared/dev-env/dev-env-types'
import {
  isDevContainerTool,
  type DevContainerTool,
  type DevTool,
  type DevToolView
} from '../../shared/dev-env/dev-tools-types'
import { DevEnvInfra } from './dev-env-infra'
import { probeHttpReady } from './dev-env-port-owner'
import type { DevEnvExec } from './dev-env-shell-command'
import { getBullmqDashboardSource } from './dev-tools-bullmq-dashboard'
import {
  DEV_TOOLS_COMPOSE_PROJECT,
  buildDevToolsComposeJson,
  getInfraPostgresUser,
  toDevToolComposeServices
} from './dev-tools-compose'

type ToolsProject = Pick<DevEnvInfra, 'getStatus' | 'ensure' | 'stop'>

// Why: the BullMQ dashboard installs its packages on first start, which takes a while.
const DEFAULT_READY_TIMEOUT_MS = 180_000
const READY_POLL_MS = 1000

/** Data tools for the Tools page: container tools in their own compose project, links to infra UIs. */
export class DevTools {
  private readonly tools: ToolsProject
  private readonly starting = new Set<string>()

  constructor(
    private readonly deps: {
      dir: string
      getSettings: () => DevEnvGlobalSettings
      infra: Pick<DevEnvInfra, 'getStatus'>
      exec?: DevEnvExec
      tools?: ToolsProject
      probeHttp?: (port: number, path: string) => Promise<boolean>
      sleep?: (ms: number) => Promise<void>
      readyTimeoutMs?: number
    }
  ) {
    this.tools =
      deps.tools ??
      new DevEnvInfra({
        dir: deps.dir,
        exec: deps.exec,
        project: DEV_TOOLS_COMPOSE_PROJECT,
        // Why: a changed port or infra password must reach the container on the next start.
        recreateChanged: true,
        getServices: () => toDevToolComposeServices(this.getContainerTools()),
        buildCompose: () =>
          buildDevToolsComposeJson(
            this.getContainerTools(),
            deps.getSettings().devEnvInfra,
            this.getScriptDir()
          )
      })
  }

  getLogPath(): string {
    return join(this.deps.dir, 'tools.log')
  }

  private getScriptDir(): string {
    return join(this.deps.dir, 'bullmq-dashboard')
  }

  private getContainerTools(): DevContainerTool[] {
    return this.deps.getSettings().devEnvTools.filter(isDevContainerTool)
  }

  private getContainerUrl(tool: DevContainerTool, service: DevEnvInfraService): string {
    const url = `http://127.0.0.1:${tool.port}`
    return tool.kind === 'adminer'
      ? `${url}/?pgsql=${tool.infraService}&username=${getInfraPostgresUser(service)}`
      : url
  }

  private getView(
    tool: DevTool,
    infraStates: DevEnvInfraState[],
    toolStates: DevEnvInfraState[]
  ): DevToolView {
    const base = { name: tool.name, label: tool.label, kind: tool.kind, url: null }
    const service = this.deps
      .getSettings()
      .devEnvInfra.find((entry) => entry.name === tool.infraService)
    if (!service) {
      return {
        ...base,
        state: 'unavailable',
        detail: `Infra service ${tool.infraService} is not defined`
      }
    }
    const port = isDevContainerTool(tool)
      ? null
      : service.ports.find((entry) => entry.name === tool.portName)
    if (!isDevContainerTool(tool) && !port) {
      return {
        ...base,
        state: 'unavailable',
        detail: `Infra service ${tool.infraService} has no port ${tool.portName}`
      }
    }
    const infraState = infraStates.find((entry) => entry.name === tool.infraService)
    if (infraState?.status !== 'running') {
      return { ...base, state: 'infra-stopped' }
    }
    if (!isDevContainerTool(tool)) {
      return { ...base, state: 'running', url: `http://127.0.0.1:${port?.host}${tool.path ?? '/'}` }
    }
    const url = this.getContainerUrl(tool, service)
    if (this.starting.has(tool.name)) {
      return { ...base, state: 'starting', url }
    }
    const running = toolStates.some(
      (entry) => entry.name === tool.name && entry.status === 'running'
    )
    return { ...base, state: running ? 'running' : 'not-started', url }
  }

  async list(): Promise<DevToolView[]> {
    const tools = this.deps.getSettings().devEnvTools
    const infraStates = await this.deps.infra.getStatus()
    if ('error' in infraStates) {
      return tools.map((tool) => ({
        name: tool.name,
        label: tool.label,
        kind: tool.kind,
        url: null,
        state: 'unavailable',
        detail: infraStates.error
      }))
    }
    const toolStates = this.getContainerTools().length > 0 ? await this.tools.getStatus() : []
    return tools.map((tool) =>
      this.getView(tool, infraStates, 'error' in toolStates ? [] : toolStates)
    )
  }

  async open(name: string): Promise<{ url: string } | { error: string }> {
    const tool = this.deps.getSettings().devEnvTools.find((entry) => entry.name === name)
    const view = (await this.list()).find((entry) => entry.name === name)
    if (!tool || !view) {
      return { error: `Unknown tool ${name}` }
    }
    if (view.state === 'infra-stopped') {
      return { error: `Infra service ${tool.infraService} is not running` }
    }
    if (view.state === 'unavailable' || !view.url) {
      return { error: view.detail ?? `${tool.label} is not available` }
    }
    if (!isDevContainerTool(tool) || view.state === 'running') {
      return { url: view.url }
    }
    if (tool.kind === 'bullmq-dashboard') {
      mkdirSync(this.getScriptDir(), { recursive: true })
      writeFileSync(join(this.getScriptDir(), 'server.mjs'), getBullmqDashboardSource())
    }
    this.starting.add(name)
    try {
      const result = await this.tools.ensure([name], this.getLogPath())
      if (!result.ok) {
        return { error: result.error }
      }
      // Why: compose reports a container as up before the tool inside listens; an early tab shows an error page.
      return (await this.waitUntilAnswering(tool.port))
        ? { url: view.url }
        : {
            error: `${tool.label} did not answer on port ${tool.port}; see the Tools log`
          }
    } finally {
      this.starting.delete(name)
    }
  }

  private async waitUntilAnswering(port: number): Promise<boolean> {
    const probe = this.deps.probeHttp ?? probeHttpReady
    const sleep =
      this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    const deadline = Date.now() + (this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    for (;;) {
      if (await probe(port, '/')) {
        return true
      }
      if (Date.now() >= deadline) {
        return false
      }
      await sleep(READY_POLL_MS)
    }
  }

  async stop(name: string): Promise<void> {
    await this.tools.stop(name, this.getLogPath())
  }

  async restart(name: string): Promise<{ url: string } | { error: string }> {
    await this.stop(name)
    return this.open(name)
  }
}
