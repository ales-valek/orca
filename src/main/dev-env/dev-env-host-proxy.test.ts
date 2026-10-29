import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DevEnvHostProxy,
  getDevEnvProxyListenHost,
  isLoopbackAddress,
  matchDevEnvHostRoute
} from './dev-env-host-proxy'

describe('matchDevEnvHostRoute', () => {
  const routes = new Map([
    ['admin.kiosek', 'http://127.0.0.1:20120'],
    ['*.eshop.kiosek', 'http://127.0.0.1:20150'],
    ['*.kiosek', 'http://127.0.0.1:20199'],
    ['api.admin.kiosek', 'http://127.0.0.1:20110']
  ])

  it('prefers an exact host', () => {
    expect(matchDevEnvHostRoute(routes, 'admin.kiosek.orca.localhost')).toBe(
      'http://127.0.0.1:20120'
    )
    expect(matchDevEnvHostRoute(routes, 'api.admin.kiosek.orca.localhost')).toBe(
      'http://127.0.0.1:20110'
    )
  })

  it('matches wildcards one or more labels deep and prefers the longest', () => {
    expect(matchDevEnvHostRoute(routes, '0193a1.eshop.kiosek.orca.localhost')).toBe(
      'http://127.0.0.1:20150'
    )
    expect(matchDevEnvHostRoute(routes, 'a.b.eshop.kiosek.orca.localhost')).toBe(
      'http://127.0.0.1:20150'
    )
    expect(matchDevEnvHostRoute(routes, 'other.kiosek.orca.localhost')).toBe(
      'http://127.0.0.1:20199'
    )
  })

  it('lets the bare parent of a wildcard match it', () => {
    expect(matchDevEnvHostRoute(routes, 'eshop.kiosek.orca.localhost')).toBe(
      'http://127.0.0.1:20150'
    )
  })

  it('strips the port and ignores case', () => {
    expect(matchDevEnvHostRoute(routes, 'ADMIN.Kiosek.orca.localhost:8080')).toBe(
      'http://127.0.0.1:20120'
    )
  })

  it('returns null for unknown hosts and other suffixes', () => {
    expect(matchDevEnvHostRoute(routes, 'nope.orca.localhost')).toBeNull()
    expect(matchDevEnvHostRoute(routes, 'admin.kiosek.localhost')).toBeNull()
  })
})

describe('proxy listen address', () => {
  it('binds the wildcard only where macOS refuses a privileged port on loopback', () => {
    expect(getDevEnvProxyListenHost(80, 'darwin')).toBe('::')
    expect(getDevEnvProxyListenHost(8080, 'darwin')).toBe('127.0.0.1')
    expect(getDevEnvProxyListenHost(80, 'win32')).toBe('127.0.0.1')
  })

  it('accepts only loopback peers', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.20')).toBe(false)
    expect(isLoopbackAddress('::ffff:10.0.0.2')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})

function getServerPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('server is not listening on a port')
  }
  return address.port
}

describe('DevEnvHostProxy', () => {
  const servers: http.Server[] = []
  let proxy: DevEnvHostProxy | null = null

  afterEach(async () => {
    await proxy?.close()
    proxy = null
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
    )
  })

  async function startEchoServer(host = '127.0.0.1'): Promise<number> {
    const server = http.createServer((request, response) => {
      response.end(`${request.headers.host} ${request.url}`)
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, host, resolve))
    return getServerPort(server)
  }

  function get(
    port: number,
    host: string,
    path: string
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port, path, headers: { host } },
        (response) => {
          let body = ''
          response.on('data', (chunk) => {
            body += chunk
          })
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
        }
      )
      request.on('error', reject)
      request.end()
    })
  }

  it('proxies a wildcard host to its service and keeps the original Host header', async () => {
    const targetPort = await startEchoServer()
    proxy = new DevEnvHostProxy({ getPort: () => 0 })
    expect(
      await proxy.setRoutes('e1', [
        { host: '*.eshop.kiosek', targetUrl: `http://127.0.0.1:${targetPort}` }
      ])
    ).toEqual({
      ok: true
    })
    const port = proxy.getListenPort()
    expect(await get(port!, '1.eshop.kiosek.orca.localhost', '/menu?x=1')).toEqual({
      status: 200,
      body: '1.eshop.kiosek.orca.localhost /menu?x=1'
    })
  })

  it('reaches a service that listens only on ::1', async () => {
    const targetPort = await startEchoServer('::1')
    proxy = new DevEnvHostProxy({ getPort: () => 0 })
    await proxy.setRoutes('e1', [
      { host: 'admin.kiosek', targetUrl: `http://127.0.0.1:${targetPort}` }
    ])
    expect(await get(proxy.getListenPort()!, 'admin.kiosek.orca.localhost', '/x')).toEqual({
      status: 200,
      body: 'admin.kiosek.orca.localhost /x'
    })
  })

  it('answers 404 after the owner routes are cleared', async () => {
    const targetPort = await startEchoServer()
    proxy = new DevEnvHostProxy({ getPort: () => 0 })
    await proxy.setRoutes('e1', [
      { host: 'admin.kiosek', targetUrl: `http://127.0.0.1:${targetPort}` }
    ])
    proxy.clearRoutes('e1')
    expect((await get(proxy.getListenPort()!, 'admin.kiosek.orca.localhost', '/')).status).toBe(404)
  })

  it('reports a port it cannot bind', async () => {
    const blocker = http.createServer()
    servers.push(blocker)
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const busy = getServerPort(blocker)
    proxy = new DevEnvHostProxy({ getPort: () => busy })
    const result = await proxy.setRoutes('e1', [{ host: 'a.k', targetUrl: 'http://127.0.0.1:1' }])
    expect(result).toEqual({
      ok: false,
      error: `Hostname proxy could not listen on port ${busy} (EADDRINUSE). Change it in Settings → Dev Environments.`
    })
  })
})
