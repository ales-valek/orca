import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnProcess } from '@orca/process-host'

export type TraceViewerSpawnSpec = {
  program: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: 'pipe'
}

export type TraceViewerChild = {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  once(event: 'exit', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  kill(): boolean
}

type Viewer = { child: TraceViewerChild; url: Promise<string> }

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000
const DEFAULT_MAX_VIEWERS = 3
const LISTENING = /Listening on (http:\/\/\S+)/

function resolvePlaywrightCliInRepo(repoRoot: string): string | null {
  const candidates = [
    join(repoRoot, 'node_modules', 'playwright', 'cli.js'),
    join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Runs the test repo's own `playwright show-trace` as a local web server for an Orca browser tab.
 * Why one per trace: the viewer refuses to serve any file it was not started with.
 */
export class TraceViewers {
  private readonly viewers = new Map<string, Viewer>()

  constructor(
    private readonly deps: {
      spawn?: (spec: TraceViewerSpawnSpec) => TraceViewerChild
      resolvePlaywrightCli?: (repoRoot: string) => string | null
      startupTimeoutMs?: number
      maxViewers?: number
    } = {}
  ) {}

  async open(traceFile: string, repoRoot: string): Promise<{ url: string } | { error: string }> {
    let viewer = this.viewers.get(traceFile)
    if (viewer) {
      // Map order is the recency order for eviction.
      this.viewers.delete(traceFile)
      this.viewers.set(traceFile, viewer)
    } else {
      const cli = (this.deps.resolvePlaywrightCli ?? resolvePlaywrightCliInRepo)(repoRoot)
      if (!cli) {
        return { error: `Playwright is not installed in ${repoRoot}` }
      }
      viewer = this.start(cli, traceFile, repoRoot)
      this.viewers.set(traceFile, viewer)
      this.evictOldest()
    }
    try {
      return { url: await viewer.url }
    } catch (error) {
      viewer.child.kill()
      this.forget(traceFile, viewer)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  disposeAll(): void {
    for (const viewer of this.viewers.values()) {
      viewer.child.kill()
    }
    this.viewers.clear()
  }

  private start(cli: string, traceFile: string, repoRoot: string): Viewer {
    const spawn = this.deps.spawn ?? spawnProcess
    const child = spawn({
      program: process.execPath,
      args: [cli, 'show-trace', '--host', '127.0.0.1', '--port', '0', traceFile],
      cwd: repoRoot,
      // Why: Orca's own binary runs the repo's Playwright as plain Node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'pipe'
    })
    // Why drain: an unread stderr pipe fills up and stalls the viewer.
    child.stderr?.resume()
    const viewer: Viewer = { child, url: Promise.resolve('') }
    viewer.url = new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(
        () => reject(new Error('The trace viewer did not start')),
        this.deps.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
      )
      child.stdout?.on('data', (chunk: Buffer | string) => {
        output += chunk.toString()
        const match = LISTENING.exec(output)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        this.forget(traceFile, viewer)
        reject(error)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        this.forget(traceFile, viewer)
        reject(new Error('The trace viewer exited'))
      })
    })
    // Why: a viewer nobody awaits (evicted, never opened) must not reject unhandled.
    viewer.url.catch(() => undefined)
    return viewer
  }

  /** Only this viewer: a reopened trace may already have a newer one. */
  private forget(traceFile: string, viewer: Viewer): void {
    if (this.viewers.get(traceFile) === viewer) {
      this.viewers.delete(traceFile)
    }
  }

  private evictOldest(): void {
    const max = this.deps.maxViewers ?? DEFAULT_MAX_VIEWERS
    for (const [file, viewer] of this.viewers) {
      if (this.viewers.size <= max) {
        return
      }
      viewer.child.kill()
      this.viewers.delete(file)
    }
  }
}
