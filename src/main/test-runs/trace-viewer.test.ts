import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { TraceViewers, type TraceViewerChild, type TraceViewerSpawnSpec } from './trace-viewer'

type FakeChild = TraceViewerChild &
  EventEmitter & { killed: boolean; stdout: PassThrough; stderr: PassThrough }

function createFakeSpawn(output: string | null): {
  spawn: (spec: TraceViewerSpawnSpec) => TraceViewerChild
  specs: TraceViewerSpawnSpec[]
  children: FakeChild[]
} {
  const specs: TraceViewerSpawnSpec[] = []
  const children: FakeChild[] = []
  const spawn = (spec: TraceViewerSpawnSpec): TraceViewerChild => {
    specs.push(spec)
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill() {
        child.killed = true
        return true
      }
    })
    children.push(child)
    if (output !== null) {
      setTimeout(() => child.stdout.write(output), 0)
    }
    return child
  }
  return { spawn, specs, children }
}

describe('TraceViewers', () => {
  it('returns the viewer url', async () => {
    const fake = createFakeSpawn('Listening on http://127.0.0.1:53001\n')
    const viewers = new TraceViewers({ spawn: fake.spawn, resolvePlaywrightCli: () => '/r/cli.js' })
    await expect(viewers.open('/runs/1/trace.zip', '/repo')).resolves.toEqual({
      url: 'http://127.0.0.1:53001'
    })
    expect(fake.specs[0].args).toEqual([
      '/r/cli.js',
      'show-trace',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '/runs/1/trace.zip'
    ])
    expect(fake.specs[0].env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('reuses the viewer for the same trace', async () => {
    const fake = createFakeSpawn('Listening on http://127.0.0.1:53001\n')
    const viewers = new TraceViewers({ spawn: fake.spawn, resolvePlaywrightCli: () => '/r/cli.js' })
    await viewers.open('/runs/1/trace.zip', '/repo')
    await viewers.open('/runs/1/trace.zip', '/repo')
    expect(fake.specs).toHaveLength(1)
  })

  it('closes the least recently used viewer above the limit', async () => {
    const fake = createFakeSpawn('Listening on http://127.0.0.1:53001\n')
    const viewers = new TraceViewers({
      spawn: fake.spawn,
      resolvePlaywrightCli: () => '/r/cli.js',
      maxViewers: 2
    })
    await viewers.open('/a.zip', '/repo')
    await viewers.open('/b.zip', '/repo')
    await viewers.open('/a.zip', '/repo')
    await viewers.open('/c.zip', '/repo')
    expect(fake.children.map((child) => child.killed)).toEqual([false, true, false])
  })

  it('keeps a reopened viewer when the evicted one exits later', async () => {
    const fake = createFakeSpawn('Listening on http://127.0.0.1:53001\n')
    const viewers = new TraceViewers({
      spawn: fake.spawn,
      resolvePlaywrightCli: () => '/r/cli.js',
      maxViewers: 1
    })
    await viewers.open('/a.zip', '/repo')
    await viewers.open('/b.zip', '/repo')
    await viewers.open('/a.zip', '/repo')
    fake.children[0].emit('exit')
    await viewers.open('/a.zip', '/repo')
    expect(fake.specs).toHaveLength(3)
  })

  it('reports a viewer that cannot be spawned', async () => {
    const fake = createFakeSpawn(null)
    const viewers = new TraceViewers({ spawn: fake.spawn, resolvePlaywrightCli: () => '/r/cli.js' })
    const opened = viewers.open('/a.zip', '/repo')
    fake.children[0].emit('error', new Error('spawn ENOENT'))
    await expect(opened).resolves.toEqual({ error: 'spawn ENOENT' })
  })

  it('reports a repo without Playwright', async () => {
    const fake = createFakeSpawn(null)
    const viewers = new TraceViewers({ spawn: fake.spawn, resolvePlaywrightCli: () => null })
    await expect(viewers.open('/a.zip', '/repo')).resolves.toEqual({
      error: 'Playwright is not installed in /repo'
    })
  })

  it('fails after the startup timeout', async () => {
    const fake = createFakeSpawn(null)
    const viewers = new TraceViewers({
      spawn: fake.spawn,
      resolvePlaywrightCli: () => '/r/cli.js',
      startupTimeoutMs: 10
    })
    await expect(viewers.open('/a.zip', '/repo')).resolves.toEqual({
      error: 'The trace viewer did not start'
    })
    expect(fake.children[0].killed).toBe(true)
    // A failed viewer is not reused.
    await viewers.open('/a.zip', '/repo')
    expect(fake.specs).toHaveLength(2)
  })
})
