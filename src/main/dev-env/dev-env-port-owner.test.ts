import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findListeningLoopback,
  isPortFree,
  isPortListening,
  probeHttpReady
} from './dev-env-port-owner'

const servers: http.Server[] = []

async function listen(host: string): Promise<number> {
  const server = http.createServer((_request, response) => response.end('ok'))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, host, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('no port')
  }
  return address.port
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  )
})

describe('dev env port probes', () => {
  it('treats a port held on 0.0.0.0 as taken', async () => {
    const port = await listen('0.0.0.0')
    expect(await isPortFree(port)).toBe(false)
  })

  it('treats a port held only on ::1 as taken and listening', async () => {
    const port = await listen('::1')
    expect(await isPortFree(port)).toBe(false)
    expect(await isPortListening(port)).toBe(true)
    expect(await findListeningLoopback(port)).toBe('::1')
  })

  it('probes HTTP readiness on whichever loopback answers', async () => {
    const port = await listen('::1')
    expect(await probeHttpReady(port, '/')).toBe(true)
  })

  it('reports a closed port as free and not listening', async () => {
    const port = await listen('127.0.0.1')
    await new Promise((resolve) => servers.pop()?.close(resolve))
    expect(await isPortListening(port)).toBe(false)
    expect(await isPortFree(port)).toBe(true)
  })
})
