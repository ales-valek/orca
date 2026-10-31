import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { getRepoKey } from '../../shared/test-runs/test-identity'
import type { TestResultRecord, TestRunRecord } from '../../shared/test-runs/test-run-types'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_AGE_DAYS = 14
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024
const DEFAULT_MAX_CACHED_RUNS = 50
/** A run that wrote nothing this long is dead even if its pid answers (reboot, pid reuse). */
const STALE_RUNNING_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export type TestResultEntry = { result: TestResultRecord; run: TestRunRecord }

export type TestRunFilter = { worktreeId?: string; repoKey?: string; limit?: number }

function isProcessAliveByPid(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

// Why tolerant: the reporter renames files while a prune walks the run.
function getDirectorySize(path: string): number {
  try {
    return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
      const child = join(path, entry.name)
      return total + (entry.isDirectory() ? getDirectorySize(child) : getFileSize(child))
    }, 0)
  } catch {
    return 0
  }
}

function getFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function getModifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/** Reads the run directories Orca's Playwright reporter writes. */
export class TestRunStore {
  /** Finished runs never change, so their records and results are read once. */
  private readonly finishedRuns = new Map<string, TestRunRecord>()
  private readonly resultsCache = new Map<string, TestResultRecord[]>()

  constructor(
    private readonly deps: {
      dir: string
      now?: () => number
      isProcessAlive?: (pid: number) => boolean
      readFile?: (path: string) => string
      maxCachedRuns?: number
    }
  ) {}

  private readText(path: string): string {
    return (this.deps.readFile ?? ((file: string) => readFileSync(file, 'utf8')))(path)
  }

  private get runsDir(): string {
    return join(this.deps.dir, 'runs')
  }

  private readRun(id: string): TestRunRecord | null {
    const finished = this.finishedRuns.get(id)
    if (finished) {
      return finished
    }
    const file = join(this.runsDir, id, 'run.json')
    try {
      const run: TestRunRecord = JSON.parse(this.readText(file))
      const isAlive = this.deps.isProcessAlive ?? isProcessAliveByPid
      if (run.status === 'running' && isAlive(run.pid) && !this.isStale(id)) {
        return run
      }
      if (run.status !== 'running') {
        this.finishedRuns.set(id, run)
        return run
      }
      // Why: a killed run never reaches onEnd and would show as running forever.
      const interrupted: TestRunRecord = { ...run, status: 'interrupted' }
      writeFileSync(`${file}.tmp`, JSON.stringify(interrupted, null, 2))
      renameSync(`${file}.tmp`, file)
      this.finishedRuns.set(id, interrupted)
      return interrupted
    } catch {
      return null
    }
  }

  private isStale(id: string): boolean {
    const lastWriteAt = Math.max(
      getModifiedAt(join(this.runsDir, id, 'run.json')),
      getModifiedAt(join(this.runsDir, id, 'results.jsonl'))
    )
    return (this.deps.now ?? Date.now)() - lastWriteAt > STALE_RUNNING_MS
  }

  private readAllRuns(): TestRunRecord[] {
    if (!existsSync(this.runsDir)) {
      return []
    }
    return readdirSync(this.runsDir)
      .map((id) => this.readRun(id))
      .filter((run): run is TestRunRecord => run !== null)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  listRuns(filter: TestRunFilter = {}): TestRunRecord[] {
    const runs = this.readAllRuns().filter(
      (run) =>
        (filter.worktreeId === undefined || run.worktreeId === filter.worktreeId) &&
        (filter.repoKey === undefined || getRepoKey(run.repo) === filter.repoKey)
    )
    return filter.limit === undefined ? runs : runs.slice(0, filter.limit)
  }

  getRunResults(runId: string): TestResultRecord[] {
    const cached = this.resultsCache.get(runId)
    if (cached) {
      // Map order is the recency order for eviction.
      this.resultsCache.delete(runId)
      this.resultsCache.set(runId, cached)
      return cached
    }
    // Why before reading: results read while the run still ran may miss its last tests.
    const isFinished = this.readRun(runId)?.status !== 'running'
    let results: TestResultRecord[] = []
    try {
      results = this.readText(join(this.runsDir, runId, 'results.jsonl'))
        .split('\n')
        .flatMap((line) => {
          try {
            return line ? [JSON.parse(line)] : []
          } catch {
            return []
          }
        })
    } catch {
      return []
    }
    if (isFinished) {
      this.resultsCache.set(runId, results)
      for (const id of this.resultsCache.keys()) {
        if (this.resultsCache.size <= (this.deps.maxCachedRuns ?? DEFAULT_MAX_CACHED_RUNS)) {
          break
        }
        this.resultsCache.delete(id)
      }
    }
    return results
  }

  /**
   * One entry per test and run: its last record. Why not the reporter's final-attempt guess:
   * a serial group re-runs tests that already passed or were skipped on an earlier attempt.
   */
  private getRunEntries(runs: TestRunRecord[]): TestResultEntry[] {
    return runs.flatMap((run) => {
      const last = new Map<string, TestResultRecord>()
      for (const result of this.getRunResults(run.id)) {
        last.set(result.identity, result)
      }
      return [...last.values()].map((result) => ({ result, run }))
    })
  }

  /** Without stdout/stderr: lists only need the outcome; a test's history carries the output. */
  getLatestResults(filter: Omit<TestRunFilter, 'limit'>): TestResultEntry[] {
    const latest = new Map<string, TestResultEntry>()
    for (const entry of this.getRunEntries(this.listRuns(filter))) {
      if (!latest.has(entry.result.identity)) {
        latest.set(entry.result.identity, {
          run: entry.run,
          result: { ...entry.result, stdout: '', stderr: '' }
        })
      }
    }
    return [...latest.values()]
  }

  getHistory(identity: string, limit = 20): TestResultEntry[] {
    return this.getRunEntries(this.listRuns())
      .filter((entry) => entry.result.identity === identity)
      .slice(0, limit)
  }

  getArtifactPath(runId: string, file: string): string | null {
    const runDir = resolve(this.runsDir, runId)
    const target = resolve(runDir, file)
    if (resolve(this.runsDir) !== resolve(runDir, '..') || !target.startsWith(runDir + sep)) {
      return null
    }
    return existsSync(target) ? target : null
  }

  /** Screenshots for the renderer; Orca's media protocol serves only audio and video. */
  readImageDataUrl(runId: string, file: string, maxBytes = DEFAULT_MAX_IMAGE_BYTES): string | null {
    const path = this.getArtifactPath(runId, file)
    const mimeType = IMAGE_MIME_TYPES[extname(file).toLowerCase()]
    if (!path || !mimeType || statSync(path).size > maxBytes) {
      return null
    }
    return `data:${mimeType};base64,${readFileSync(path).toString('base64')}`
  }

  prune(limits: { maxAgeDays?: number; maxBytes?: number } = {}): { removedRunIds: string[] } {
    const now = (this.deps.now ?? Date.now)()
    const maxAgeMs = (limits.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * DAY_MS
    const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES
    const runs = this.readAllRuns()
    const protectedIds = new Set(
      runs.filter((run) => run.status === 'running').map((run) => run.id)
    )
    for (const entry of this.getLatestResults({})) {
      protectedIds.add(entry.run.id)
    }
    const sizes = new Map(runs.map((run) => [run.id, getDirectorySize(join(this.runsDir, run.id))]))
    let totalBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0)
    const removedRunIds: string[] = []
    // Folders a reporter never finished writing a run record into, once old.
    const knownIds = new Set(runs.map((run) => run.id))
    for (const id of existsSync(this.runsDir) ? readdirSync(this.runsDir) : []) {
      const path = join(this.runsDir, id)
      if (!knownIds.has(id) && now - getModifiedAt(path) > maxAgeMs) {
        rmSync(path, { recursive: true, force: true })
        removedRunIds.push(id)
      }
    }
    for (const run of runs.toReversed()) {
      if (protectedIds.has(run.id)) {
        continue
      }
      if (now - run.startedAt <= maxAgeMs && totalBytes <= maxBytes) {
        continue
      }
      rmSync(join(this.runsDir, run.id), { recursive: true, force: true })
      this.resultsCache.delete(run.id)
      this.finishedRuns.delete(run.id)
      totalBytes -= sizes.get(run.id) ?? 0
      removedRunIds.push(run.id)
    }
    return { removedRunIds }
  }
}
