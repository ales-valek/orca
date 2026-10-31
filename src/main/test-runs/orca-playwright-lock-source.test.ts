import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrcaPlaywrightLockSource } from './orca-playwright-lock-source'

type Holder = { pid: number; trigger: string; label: string }
type LockModule = ((config?: unknown) => Promise<(() => Promise<void>) | undefined>) & {
  getLockKey: (env: Record<string, string | undefined>) => string
  acquireLock: (input: {
    dir: string
    key: string
    holder: Holder
    signal?: AbortSignal
    onWait?: (holder: Holder) => void
    pollMs?: number
  }) => Promise<() => void>
}

const HOLDER: Holder = { pid: process.pid, trigger: 'agent', label: 'kiosek' }
// Far above macOS and Linux pid limits, so never a live process.
const DEAD_PID = 99_999_999

let dir: string

function loadLock(): LockModule {
  const file = join(dir, `lock-${Math.random().toString(36).slice(2)}.cjs`)
  writeFileSync(file, getOrcaPlaywrightLockSource())
  return createRequire(import.meta.url)(file)
}

function lockFiles(): string[] {
  const locks = join(dir, 'locks')
  return existsSync(locks)
    ? readdirSync(locks).flatMap((target) => readdirSync(join(locks, target)))
    : []
}

describe('Orca Playwright run lock', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-lock-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  it('acquires and releases a lock', async () => {
    const lock = loadLock()
    const release = await lock.acquireLock({ dir, key: 'dev-env:a#', holder: HOLDER })
    expect(lockFiles()).toHaveLength(1)
    release()
    expect(lockFiles()).toHaveLength(0)
  })

  it('waits for a held lock and reports the holder once', async () => {
    const lock = loadLock()
    const releaseFirst = await lock.acquireLock({ dir, key: 'dev-env:a#', holder: HOLDER })
    const waits: Holder[] = []
    let isAcquired = false
    const second = lock
      .acquireLock({
        dir,
        key: 'dev-env:a#',
        holder: { ...HOLDER, trigger: 'orca' },
        onWait: (holder) => waits.push(holder),
        pollMs: 5
      })
      .then((release) => {
        isAcquired = true
        return release
      })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(isAcquired).toBe(false)
    expect(waits).toEqual([expect.objectContaining({ pid: process.pid, trigger: 'agent' })])
    releaseFirst()
    ;(await second)()
    expect(isAcquired).toBe(true)
  })

  it('takes over a lock whose holder is gone', async () => {
    const lock = loadLock()
    const target = join(dir, 'locks', createHash('sha1').update('dev-env:a').digest('hex'))
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, '_all.json'), JSON.stringify({ ...HOLDER, pid: DEAD_PID }))
    const release = await lock.acquireLock({ dir, key: 'dev-env:a#', holder: HOLDER, pollMs: 5 })
    release()
    expect(lockFiles()).toHaveLength(0)
  })

  it('lets different lanes run side by side', async () => {
    const lock = loadLock()
    const eshop = await lock.acquireLock({ dir, key: 'dev-env:a#eshop', holder: HOLDER })
    const admin = await lock.acquireLock({ dir, key: 'dev-env:a#admin', holder: HOLDER })
    expect(lockFiles()).toHaveLength(2)
    eshop()
    admin()
  })

  it('makes a run without a lane wait for every lane, and every lane wait for it', async () => {
    const lock = loadLock()
    const eshop = await lock.acquireLock({ dir, key: 'dev-env:a#eshop', holder: HOLDER })
    let isWholeAcquired = false
    const whole = lock
      .acquireLock({ dir, key: 'dev-env:a#', holder: HOLDER, pollMs: 5 })
      .then((release) => {
        isWholeAcquired = true
        return release
      })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(isWholeAcquired).toBe(false)
    eshop()
    const releaseWhole = await whole
    let isAdminAcquired = false
    const admin = lock
      .acquireLock({ dir, key: 'dev-env:a#admin', holder: HOLDER, pollMs: 5 })
      .then((release) => {
        isAdminAcquired = true
        return release
      })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(isAdminAcquired).toBe(false)
    releaseWhole()
    ;(await admin)()
  })

  it('keeps other environments independent', async () => {
    const lock = loadLock()
    const first = await lock.acquireLock({ dir, key: 'dev-env:a#', holder: HOLDER })
    const second = await lock.acquireLock({ dir, key: 'dev-env:b#', holder: HOLDER })
    first()
    second()
  })

  it('stops waiting when aborted', async () => {
    const lock = loadLock()
    const release = await lock.acquireLock({ dir, key: 'dev-env:a#', holder: HOLDER })
    const controller = new AbortController()
    const waiting = lock.acquireLock({
      dir,
      key: 'dev-env:a#',
      holder: HOLDER,
      signal: controller.signal,
      pollMs: 5
    })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    release()
  })

  it('derives the key from the target map, then the worktree, then cwd', () => {
    const lock = loadLock()
    writeFileSync(join(dir, 'targets.json'), JSON.stringify({ w1: 'env-1' }))
    const base = { ORCA_TEST_RUNS_DIR: dir, ORCA_TEST_LOCK_SCOPE: 'eshop' }
    expect(lock.getLockKey({ ...base, ORCA_WORKTREE_ID: 'w1' })).toBe('dev-env:env-1#eshop')
    expect(lock.getLockKey({ ...base, ORCA_WORKTREE_ID: 'w2' })).toBe('worktree:w2#eshop')
    expect(lock.getLockKey({ ORCA_TEST_RUNS_DIR: dir })).toBe(`cwd:${process.cwd()}#`)
    expect(
      lock.getLockKey({ ...base, ORCA_WORKTREE_ID: 'w1', ORCA_TEST_LOCK_KEY: 'preset:dev' })
    ).toBe('preset:dev#eshop')
  })

  it('does nothing when the launcher already holds the lock', async () => {
    const lock = loadLock()
    vi.stubEnv('ORCA_TEST_RUNS_DIR', dir)
    vi.stubEnv('ORCA_TEST_LOCK_HELD', '1')
    await expect(lock()).resolves.toBeUndefined()
    expect(lockFiles()).toHaveLength(0)
  })

  it('locks a direct run until its teardown', async () => {
    const lock = loadLock()
    vi.stubEnv('ORCA_TEST_RUNS_DIR', dir)
    vi.stubEnv('ORCA_TEST_LOCK_HELD', '')
    vi.stubEnv('ORCA_WORKTREE_ID', 'w9')
    const teardown = await lock()
    expect(lockFiles()).toHaveLength(1)
    await teardown?.()
    expect(lockFiles()).toHaveLength(0)
  })
})
