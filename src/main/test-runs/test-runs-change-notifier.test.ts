import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { TestRunRecord, TestRunStatus } from '../../shared/test-runs/test-run-types'
import { TestRunsChangeNotifier, type RunsWatcher } from './test-runs-change-notifier'

function makeRun(status: TestRunStatus): TestRunRecord {
  return {
    id: 'r1',
    status,
    startedAt: 1,
    endedAt: null,
    pid: 1,
    trigger: 'agent',
    worktreeId: null,
    paneKey: null,
    repo: { root: '/w', originUrl: null, commit: null, branch: null },
    configFile: 'playwright.config.ts',
    argv: [],
    lane: null,
    totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 }
  }
}

function createNotifier(statuses: TestRunStatus[]): {
  notifier: TestRunsChangeNotifier
  watcher: EventEmitter & RunsWatcher
  notifications: () => number
} {
  let count = 0
  let call = 0
  const watcher = Object.assign(new EventEmitter(), { close: () => undefined })
  const notifier = new TestRunsChangeNotifier({
    runsDir: '/runs',
    store: { listRuns: () => [makeRun(statuses[Math.min(call++, statuses.length - 1)])] },
    notify: () => count++,
    watch: () => watcher
  })
  notifier.start()
  return { notifier, watcher, notifications: () => count }
}

describe('TestRunsChangeNotifier', () => {
  it('notifies when a running run ends without writing anything', () => {
    const { notifier, notifications } = createNotifier(['running', 'running', 'interrupted'])
    notifier.tick()
    notifier.tick()
    expect(notifications()).toBe(0)
    notifier.tick()
    expect(notifications()).toBe(1)
    notifier.stop()
  })

  it('survives a failing watcher and keeps a running run fresh by polling', () => {
    const { notifier, watcher, notifications } = createNotifier(['running'])
    expect(() => watcher.emit('error', new Error('EMFILE'))).not.toThrow()
    notifier.tick()
    notifier.tick()
    expect(notifications()).toBe(2)
    notifier.stop()
  })
})
