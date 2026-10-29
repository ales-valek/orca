import { getDevEnvServiceUrl } from '../../shared/dev-env/dev-env-context'
import { getDevEnvPort } from '../../shared/dev-env/dev-env-ports'
import type {
  DevEnv,
  DevEnvServiceDef,
  DevEnvServiceState,
  DevEnvServiceStatus,
  DevEnvTemplate
} from '../../shared/dev-env/dev-env-types'

export type DevEnvTerminalPort = {
  create(
    worktreeId: string,
    opts: { command: string; title: string; cwd: string }
  ): Promise<{ handle: string }>
  isAlive(handle: string): Promise<{ alive: boolean; exitCode: number | null }>
  close(handle: string): Promise<void>
  /** Finds a service terminal after an Orca restart, when in-memory handles are gone. */
  findByTitle?(worktreeId: string, title: string): Promise<string | null>
}

type DevEnvServicesDeps = {
  terminals: DevEnvTerminalPort
  /** True when something listens on the port. */
  probePort: (port: number) => Promise<boolean>
  probeHttp: (port: number, path: string) => Promise<boolean>
  notify: (envId: string) => void
  renderCommand: (
    env: DevEnv,
    template: DevEnvTemplate,
    command: string
  ) => Promise<{ command: string } | { error: string }>
  /** Who holds a port this service needs, or null when it is free. */
  findPortHolder?: (port: number) => Promise<string | null>
  sleep?: (ms: number) => Promise<void>
  readyTimeoutMs?: number
}

type SlotService = { slot: string; service: DevEnvServiceDef }

const READY_POLL_MS = 1000
const DEFAULT_READY_TIMEOUT_MS = 120_000

/** Topological order by `dependsOn` among service names; infra names are ignored. */
export function orderDevEnvServices(services: DevEnvServiceDef[]): string[] | { error: string } {
  const byName = new Map(services.map((service) => [service.name, service]))
  const order: string[] = []
  const done = new Set<string>()
  const visit = (name: string, path: string[]): string | null => {
    if (done.has(name)) {
      return null
    }
    if (path.includes(name)) {
      return [...path.slice(path.indexOf(name)), name].join(' → ')
    }
    for (const dependency of byName.get(name)?.dependsOn ?? []) {
      if (byName.has(dependency)) {
        const cycle = visit(dependency, [...path, name])
        if (cycle) {
          return cycle
        }
      }
    }
    done.add(name)
    order.push(name)
    return null
  }
  for (const service of services) {
    const cycle = visit(service.name, [])
    if (cycle) {
      return { error: `Service dependency cycle: ${cycle}` }
    }
  }
  return order
}

function listSlotServices(template: DevEnvTemplate): SlotService[] {
  return template.slots.flatMap((slot) =>
    slot.services.map((service) => ({ slot: slot.name, service }))
  )
}

export class DevEnvServices {
  private readonly handles = new Map<string, Map<string, string>>()
  private readonly moved = new Map<string, Set<string>>()

  constructor(private readonly deps: DevEnvServicesDeps) {}

  private handlesFor(envId: string): Map<string, string> {
    let handles = this.handles.get(envId)
    if (!handles) {
      handles = new Map()
      this.handles.set(envId, handles)
    }
    return handles
  }

  private async findHandle(env: DevEnv, entry: SlotService): Promise<string | null> {
    const handles = this.handlesFor(env.id)
    const known = handles.get(entry.service.name)
    if (known) {
      return known
    }
    const worktree = env.slotWorktrees[entry.slot]
    const found =
      worktree && this.deps.terminals.findByTitle
        ? await this.deps.terminals.findByTitle(
            worktree.worktreeId,
            `${env.name}:${entry.service.name}`
          )
        : null
    if (found) {
      handles.set(entry.service.name, found)
    }
    return found
  }

  private async getStatus(
    env: DevEnv,
    entry: SlotService
  ): Promise<{ status: DevEnvServiceStatus; exitCode?: number | null; handle?: string }> {
    if (!env.slotWorktrees[entry.slot]) {
      return { status: 'unbound' }
    }
    if (this.moved.get(env.id)?.has(entry.service.name)) {
      return { status: 'moved' }
    }
    const handle = await this.findHandle(env, entry)
    if (!handle) {
      return { status: 'stopped' }
    }
    const { alive, exitCode } = await this.deps.terminals.isAlive(handle)
    if (!alive) {
      return { status: 'crashed', exitCode, handle }
    }
    const port = getDevEnvPort(env.portSlot, entry.service.portOffset)
    let ready = await this.deps.probePort(port)
    if (ready && entry.service.ready?.httpPath) {
      ready = await this.deps.probeHttp(port, entry.service.ready.httpPath)
    }
    return { status: ready ? 'up' : 'starting', handle }
  }

  async getStates(
    env: DevEnv,
    template: DevEnvTemplate,
    proxyPort: number
  ): Promise<DevEnvServiceState[]> {
    return Promise.all(
      listSlotServices(template).map(async (entry) => {
        const port = getDevEnvPort(env.portSlot, entry.service.portOffset)
        const status = await this.getStatus(env, entry)
        const state: DevEnvServiceState = {
          name: entry.service.name,
          slot: entry.slot,
          status: status.status,
          port,
          url: getDevEnvServiceUrl(entry.service, env.key, port, proxyPort),
          worktreeLabel: env.slotWorktrees[entry.slot]?.label
        }
        if (status.exitCode !== undefined) {
          state.exitCode = status.exitCode
        }
        if (status.handle) {
          state.terminalHandle = status.handle
        }
        return state
      })
    )
  }

  private async waitUntilUp(env: DevEnv, entry: SlotService): Promise<boolean> {
    const sleep =
      this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    const deadline = Date.now() + (this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    for (;;) {
      if ((await this.getStatus(env, entry)).status === 'up') {
        return true
      }
      if (Date.now() >= deadline) {
        return false
      }
      await sleep(READY_POLL_MS)
    }
  }

  async start(
    env: DevEnv,
    template: DevEnvTemplate,
    names: string[] | 'all'
  ): Promise<{ started: string[]; errors: string[] }> {
    const all = listSlotServices(template)
    const order = orderDevEnvServices(all.map((entry) => entry.service))
    if (!Array.isArray(order)) {
      return { started: [], errors: [order.error] }
    }
    const started: string[] = []
    const errors: string[] = []
    const handles = this.handlesFor(env.id)
    for (const name of order) {
      const entry = all.find((candidate) => candidate.service.name === name)
      if (!entry || (names !== 'all' && !names.includes(name))) {
        continue
      }
      const worktree = env.slotWorktrees[entry.slot]
      if (!worktree) {
        errors.push(`${name}: slot ${entry.slot} has no worktree`)
        continue
      }
      this.moved.get(env.id)?.delete(name)
      const current = await this.getStatus(env, entry)
      if (current.status === 'up' || current.status === 'starting') {
        continue
      }
      if (current.handle) {
        await this.deps.terminals.close(current.handle)
      }
      for (const dependency of entry.service.dependsOn) {
        const dependencyEntry = all.find((candidate) => candidate.service.name === dependency)
        if (
          dependencyEntry &&
          handles.has(dependency) &&
          !(await this.waitUntilUp(env, dependencyEntry))
        ) {
          errors.push(`${name}: ${dependency} was not up in time`)
        }
      }
      const port = getDevEnvPort(env.portSlot, entry.service.portOffset)
      const holder = await this.deps.findPortHolder?.(port)
      if (holder) {
        errors.push(`${name}: port ${port} is held by ${holder}. Orca did not start ${name}.`)
        continue
      }
      const rendered = await this.deps.renderCommand(env, template, entry.service.command)
      if ('error' in rendered) {
        errors.push(`${name}: ${rendered.error}`)
        continue
      }
      const { handle } = await this.deps.terminals.create(worktree.worktreeId, {
        command: rendered.command,
        title: `${env.name}:${name}`,
        cwd: worktree.path
      })
      handles.set(name, handle)
      started.push(name)
      this.deps.notify(env.id)
    }
    return { started, errors }
  }

  async stop(envId: string, names: string[] | 'all'): Promise<void> {
    const handles = this.handlesFor(envId)
    for (const [name, handle] of handles) {
      if (names === 'all' || names.includes(name)) {
        await this.deps.terminals.close(handle)
        handles.delete(name)
      }
    }
    this.deps.notify(envId)
  }

  async restart(
    env: DevEnv,
    template: DevEnvTemplate,
    name: string
  ): Promise<{ started: string[]; errors: string[] }> {
    await this.stop(env.id, [name])
    return this.start(env, template, [name])
  }

  /** Stops the services of slots whose worktree changed; they show `moved` until started again. */
  async markMoved(env: DevEnv, template: DevEnvTemplate, slots: string[]): Promise<void> {
    const names = listSlotServices(template)
      .filter((entry) => slots.includes(entry.slot))
      .map((entry) => entry.service.name)
    await this.stop(env.id, names)
    const moved = this.moved.get(env.id) ?? new Set<string>()
    for (const name of names) {
      moved.add(name)
    }
    this.moved.set(env.id, moved)
    this.deps.notify(env.id)
  }

  forget(envId: string): void {
    this.handles.delete(envId)
    this.moved.delete(envId)
  }
}
