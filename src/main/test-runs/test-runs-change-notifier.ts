import { watch } from 'node:fs'
import type { TestRunStore } from './test-run-store'

export type RunsWatcher = {
  on(event: 'error', listener: (error: Error) => void): unknown
  close(): void
}

const DEFAULT_POLL_MS = 5000
const CHANGE_DEBOUNCE_MS = 500

function watchRunsDir(runsDir: string, onChange: () => void): RunsWatcher {
  return watch(runsDir, { recursive: true }, onChange)
}

/**
 * Tells the renderer when runs change. Why the poll next to the watcher: a killed run
 * writes nothing, and a failed watcher (inotify limits) must not leave the UI stale.
 */
export class TestRunsChangeNotifier {
  private watcher: RunsWatcher | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private signature: string | null = null

  constructor(
    private readonly deps: {
      runsDir: string
      store: Pick<TestRunStore, 'listRuns'>
      notify: () => void
      watch?: (runsDir: string, onChange: () => void) => RunsWatcher
      pollMs?: number
    }
  ) {}

  start(): void {
    this.stop()
    try {
      const watcher = (this.deps.watch ?? watchRunsDir)(this.deps.runsDir, () =>
        this.scheduleNotify()
      )
      watcher.on('error', (error) => {
        console.error('[test-runs] watching runs failed; polling instead', error)
        watcher.close()
        this.watcher = null
      })
      this.watcher = watcher
    } catch (error) {
      console.error('[test-runs] cannot watch runs; polling instead', error)
    }
    this.pollTimer = setInterval(() => this.tick(), this.deps.pollMs ?? DEFAULT_POLL_MS)
    this.pollTimer.unref?.()
  }

  tick(): void {
    try {
      const runs = this.deps.store.listRuns()
      const signature = runs.map((run) => `${run.id}:${run.status}`).join('|')
      const hasChanged = this.signature !== null && signature !== this.signature
      const isPollingRunningRun = !this.watcher && runs.some((run) => run.status === 'running')
      this.signature = signature
      if (hasChanged || isPollingRunningRun) {
        this.deps.notify()
      }
    } catch (error) {
      console.error('[test-runs] polling runs failed', error)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private scheduleNotify(): void {
    if (this.debounceTimer) {
      return
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.deps.notify()
    }, CHANGE_DEBOUNCE_MS)
  }
}
