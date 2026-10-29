import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { URL } from 'node:url'
import { connectableLoopbackHost } from '../shared/localhost-worktree-labels'

type ForwardOptions = {
  /** Keep the browser's Host header, for apps that route tenants by subdomain. */
  preserveHost: boolean
}

function requestForTarget(
  target: URL,
  options: { method?: string; headers: http.OutgoingHttpHeaders }
): http.ClientRequest {
  const requestOptions = {
    protocol: target.protocol,
    hostname: connectableLoopbackHost(target.hostname),
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: options.method,
    headers: options.headers
  }
  return target.protocol === 'https:' ? https.request(requestOptions) : http.request(requestOptions)
}

function targetUrlForRequest(target: URL, request: IncomingMessage): URL {
  const url = new URL(target.toString())
  const incomingUrl = new URL(request.url || '/', target)
  url.pathname = incomingUrl.pathname
  url.search = incomingUrl.search
  return url
}

function requestHeadersForTarget(
  request: IncomingMessage,
  target: URL,
  options: ForwardOptions
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...request.headers }
  if (!options.preserveHost) {
    headers.host = target.host
  }
  return headers
}

export function forwardProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routeTarget: URL,
  options: ForwardOptions & { label: string }
): void {
  const target = targetUrlForRequest(routeTarget, request)
  const proxyRequest = requestForTarget(target, {
    method: request.method,
    headers: requestHeadersForTarget(request, routeTarget, options)
  })

  // Downstream errors must release upstream work rather than leak requests or crash main.
  request.on('error', () => proxyRequest.destroy())
  response.on('error', () => proxyRequest.destroy())

  proxyRequest.on('response', (proxyResponse) => {
    proxyResponse.on('error', () => response.destroy())
    response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers)
    proxyResponse.pipe(response)
  })
  proxyRequest.on('error', (error) => {
    // After headers are sent, destroy the response instead of attempting a 502.
    if (response.headersSent) {
      response.destroy(error)
      return
    }
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`Proxy failed for ${options.label}: ${error.message}`)
  })
  request.pipe(proxyRequest)
}

export function forwardProxyUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  routeTarget: URL,
  options: ForwardOptions
): void {
  const target = targetUrlForRequest(routeTarget, request)
  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
  const targetSocket = net.connect(targetPort, connectableLoopbackHost(target.hostname), () => {
    const headers = requestHeadersForTarget(request, routeTarget, options)
    targetSocket.write(
      `${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/${request.httpVersion}\r\n`
    )
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          targetSocket.write(`${name}: ${entry}\r\n`)
        }
      } else if (value !== undefined) {
        targetSocket.write(`${name}: ${value}\r\n`)
      }
    }
    targetSocket.write('\r\n')
    if (head.length > 0) {
      targetSocket.write(head)
    }
    targetSocket.pipe(socket)
    socket.pipe(targetSocket)
  })
  targetSocket.on('error', () => socket.destroy())
  socket.on('error', () => targetSocket.destroy())
}
