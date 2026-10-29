import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { URL } from 'node:url'
import { forwardProxyRequest, forwardProxyUpgrade } from '../localhost-proxy-forwarding'
import { findListeningLoopback, type DevEnvLoopback } from './dev-env-port-owner'

const ORCA_LOCALHOST_SUFFIX = '.orca.localhost'

/** Target for a Host header: exact host first, then the longest matching `*.` wildcard. */
export function matchDevEnvHostRoute(
  routes: ReadonlyMap<string, string>,
  hostHeader: string
): string | null {
  const host = (hostHeader.split(':')[0] ?? '').toLowerCase()
  if (!host.endsWith(ORCA_LOCALHOST_SUFFIX)) {
    return null
  }
  const name = host.slice(0, -ORCA_LOCALHOST_SUFFIX.length)
  const exact = routes.get(name)
  if (exact) {
    return exact
  }
  let best: { suffix: string; target: string } | null = null
  for (const [pattern, target] of routes) {
    if (!pattern.startsWith('*.')) {
      continue
    }
    const suffix = pattern.slice(2)
    const matches = name === suffix || name.endsWith(`.${suffix}`)
    if (matches && (!best || suffix.length > best.suffix.length)) {
      best = { suffix, target }
    }
  }
  return best?.target ?? null
}

function getErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'error'
}

/** Fixed-port proxy for Dev Environment hostnames; keeps the Host header for subdomain tenants. */
export class DevEnvHostProxy {
  private server: Server | null = null
  private listenPort: number | null = null
  private readonly owners = new Map<string, Map<string, string>>()

  private readonly findLoopback: (port: number) => Promise<DevEnvLoopback | null>

  constructor(
    private readonly deps: {
      getPort: () => number
      findLoopback?: (port: number) => Promise<DevEnvLoopback | null>
    }
  ) {
    this.findLoopback = deps.findLoopback ?? findListeningLoopback
  }

  getListenPort(): number | null {
    return this.listenPort
  }

  private getRoutes(): Map<string, string> {
    const routes = new Map<string, string>()
    for (const ownerRoutes of this.owners.values()) {
      for (const [host, target] of ownerRoutes) {
        routes.set(host, target)
      }
    }
    return routes
  }

  async setRoutes(
    ownerId: string,
    routes: { host: string; targetUrl: string }[]
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    this.owners.set(
      ownerId,
      new Map(routes.map((route) => [route.host.toLowerCase(), route.targetUrl]))
    )
    if (routes.length === 0 || this.server) {
      return { ok: true }
    }
    const port = this.deps.getPort()
    try {
      await this.listen(port)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: `Hostname proxy could not listen on port ${port} (${getErrorCode(error)}). Change it in Settings → Dev Environments.`
      }
    }
  }

  clearRoutes(ownerId: string): void {
    this.owners.delete(ownerId)
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    this.listenPort = null
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  private listen(port: number): Promise<void> {
    const server = http.createServer((request, response) => this.handleRequest(request, response))
    server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head))
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        const address = server.address()
        this.listenPort = address && typeof address !== 'string' ? address.port : port
        this.server = server
        resolve()
      })
    })
  }

  /** Dev servers often bind only ::1 (Node resolves localhost there first); route to whichever answers. */
  private async resolveTarget(target: string): Promise<URL> {
    const url = new URL(target)
    if ((await this.findLoopback(Number(url.port))) === '::1') {
      url.hostname = '[::1]'
    }
    return url
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const host = String(request.headers.host ?? '')
    const target = matchDevEnvHostRoute(this.getRoutes(), host)
    if (!target) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('No Dev Environment serves this host.')
      return
    }
    void this.resolveTarget(target).then((url) =>
      forwardProxyRequest(request, response, url, { label: host, preserveHost: true })
    )
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const target = matchDevEnvHostRoute(this.getRoutes(), String(request.headers.host ?? ''))
    if (!target) {
      socket.destroy()
      return
    }
    void this.resolveTarget(target).then((url) =>
      forwardProxyUpgrade(request, socket, head, url, { preserveHost: true })
    )
  }
}
