import http from 'node:http'
import { connect, createServer } from 'node:net'
import { scanPlatformListeningPorts } from '../ports/local-workspace-platform-port-scanner'
import type { RawListeningPort } from '../ports/local-workspace-port-scan-state'
import { runDevEnvExec, type DevEnvExec } from './dev-env-shell-command'

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/** Connect probe; binding instead would race a service that is about to listen. */
export function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
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

export function probeHttpReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
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
