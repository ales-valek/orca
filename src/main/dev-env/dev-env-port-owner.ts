import http from 'node:http'
import { connect, createServer } from 'node:net'
import { scanPlatformListeningPorts } from '../ports/local-workspace-platform-port-scanner'
import type { RawListeningPort } from '../ports/local-workspace-port-scan-state'
import { runDevEnvExec, type DevEnvExec } from './dev-env-shell-command'

export type DevEnvLoopback = '127.0.0.1' | '::1'

const LOOPBACKS: readonly DevEnvLoopback[] = ['127.0.0.1', '::1']

function canConnect(port: number, host: DevEnvLoopback): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, host)
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      // Why: a host without IPv6 cannot hold the port there either.
      resolve(error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL')
    })
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

/** Connect probe on both loopbacks; binding instead would race a service that is about to listen. */
export async function findListeningLoopback(port: number): Promise<DevEnvLoopback | null> {
  for (const host of LOOPBACKS) {
    if (await canConnect(port, host)) {
      return host
    }
  }
  return null
}

export async function isPortListening(port: number): Promise<boolean> {
  return (await findListeningLoopback(port)) !== null
}

/** Free means nothing answers on either loopback and both wildcard binds succeed. */
export async function isPortFree(port: number): Promise<boolean> {
  // Why: on macOS a 127.0.0.1 bind succeeds even while Docker Desktop holds 0.0.0.0 or ::.
  if (await isPortListening(port)) {
    return false
  }
  return (await canBind(port, '0.0.0.0')) && (await canBind(port, '::'))
}

export async function probeHttpReady(port: number, path: string): Promise<boolean> {
  const host = await findListeningLoopback(port)
  if (!host) {
    return false
  }
  return new Promise((resolve) => {
    const request = http.get({ host, port, path, timeout: 2000 }, (response) => {
      response.resume()
      resolve((response.statusCode ?? 500) < 500)
    })
    request.once('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.once('error', () => resolve(false))
  })
}

async function scanListeners(): Promise<RawListeningPort[]> {
  return (await scanPlatformListeningPorts({})).ports
}

/** Who holds `port`, for messages that name the holder instead of killing it. */
export async function describePortHolder(
  port: number,
  exec: DevEnvExec = runDevEnvExec,
  listListeners: () => Promise<RawListeningPort[]> = scanListeners
): Promise<string> {
  try {
    const result = await exec(
      'docker',
      [
        'ps',
        '--filter',
        `publish=${port}`,
        '--format',
        '{{.Names}} ({{.Label "com.docker.compose.project"}})'
      ],
      { timeoutMs: 10_000 }
    )
    const line = result.code === 0 ? result.stdout.split('\n')[0]?.trim() : ''
    if (line) {
      const match = /^(.+) \((.*)\)$/.exec(line)
      return match && match[2]
        ? `container ${match[1]} (compose ${match[2]})`
        : `container ${match?.[1] ?? line}`
    }
  } catch {
    // Docker is optional here; fall back to the process table.
  }
  const listener = (await listListeners().catch(() => [])).find((entry) => entry.port === port)
  if (listener?.pid) {
    return `pid ${listener.pid}${listener.processName ? ` ${listener.processName}` : ''}`
  }
  return 'an unknown process'
}
