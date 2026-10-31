import { readFileSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import { isRecord } from '../../shared/dev-env/dev-env-settings-values'
import type { TestCatalog, TestCatalogEntry } from '../../shared/test-runs/test-catalog-types'
import { getTestIdentity } from '../../shared/test-runs/test-identity'

export type CatalogChild = {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  kill(): boolean
}

type CatalogSpawnSpec = {
  program: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: 'pipe'
}

const LIST_TIMEOUT_MS = 120_000
const ERROR_TAIL = 2048
const SERIAL_PATTERN =
  /describe\.serial\s*\(|describe\.configure\(\s*\{[^}]*mode\s*:\s*['"]serial['"]/

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

// Why: Playwright reports real paths; a repo opened through a symlink (/tmp, /var) would not match.
function getRealPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function getAnnotations(value: unknown): TestCatalogEntry['annotations'] {
  return getArray(value).flatMap((annotation) =>
    isRecord(annotation) && typeof annotation.type === 'string'
      ? [
          typeof annotation.description === 'string'
            ? { type: annotation.type, description: annotation.description }
            : { type: annotation.type }
        ]
      : []
  )
}

/** The JSON report, after anything a config prints while loading (e.g. dotenv notices). */
function getJsonOutput(stdout: string): string {
  // Why +1: indexOf finds the newline before the report; -1 (none) becomes 0, the whole text.
  return stdout.startsWith('{') ? stdout : stdout.slice(stdout.indexOf('\n{') + 1)
}

/** One entry per spec and project, with the identity the reporter gives run results. */
export function parsePlaywrightList(
  json: unknown,
  input: { repoRoot: string; repoKey: string; configFile: string }
): TestCatalogEntry[] {
  if (!isRecord(json)) {
    return []
  }
  // Why rootDir: Playwright lists spec files relative to the test directory.
  const repoRoot = getRealPath(input.repoRoot)
  const rootDir = getRealPath(
    isRecord(json.config) ? getString(json.config.rootDir) : input.repoRoot
  )
  const entries: TestCatalogEntry[] = []
  const walk = (suite: unknown, titles: string[]): void => {
    if (!isRecord(suite)) {
      return
    }
    for (const spec of getArray(suite.specs)) {
      if (!isRecord(spec)) {
        continue
      }
      const file = toPosix(relative(repoRoot, join(rootDir, getString(spec.file))))
      const titlePath = [...titles, getString(spec.title)]
      const tags = getArray(spec.tags).flatMap((tag) =>
        typeof tag === 'string' ? [tag.startsWith('@') ? tag : `@${tag}`] : []
      )
      for (const test of getArray(spec.tests)) {
        if (!isRecord(test)) {
          continue
        }
        const project = getString(test.projectName)
        entries.push({
          identity: getTestIdentity({
            originUrl: null,
            repoRootName: input.repoKey,
            configFile: input.configFile,
            project,
            file,
            titlePath
          }),
          configFile: input.configFile,
          project,
          file,
          line: typeof spec.line === 'number' ? spec.line : 0,
          titlePath,
          tags,
          annotations: getAnnotations(test.annotations),
          isSerial: false
        })
      }
    }
    for (const child of getArray(suite.suites)) {
      walk(child, isRecord(child) ? [...titles, getString(child.title)] : titles)
    }
  }
  // Why: top-level suites are files; their titles are not part of a test's title path.
  for (const fileSuite of getArray(json.suites)) {
    walk(fileSuite, [])
  }
  return entries
}

/** Serial mode is not in Playwright's list output; the spec source says it. */
export function findSerialFiles(repoRoot: string, files: string[]): Set<string> {
  const serial = new Set<string>()
  for (const file of new Set(files)) {
    try {
      if (SERIAL_PATTERN.test(readFileSync(join(repoRoot, file), 'utf8'))) {
        serial.add(file)
      }
    } catch {
      // A listed file that vanished is simply not serial.
    }
  }
  return serial
}

/** Playwright's own test list per source and target, cached per commit. */
export class TestCatalogs {
  private readonly cache = new Map<string, TestCatalog>()

  constructor(
    private readonly deps: {
      spawn?: (spec: CatalogSpawnSpec) => CatalogChild
      now?: () => number
    } = {}
  ) {}

  async get(input: {
    cwd: string
    cli: string
    env: Record<string, string>
    configFile: string
    repoRoot: string
    repoKey: string
    commit: string | null
    /** Uncommitted changes: a commit no longer says which tests exist. */
    isDirty: boolean
    cacheKey: string
  }): Promise<TestCatalog> {
    const key = `${input.cacheKey}|${input.configFile}|${input.commit ?? 'uncommitted'}`
    const isCacheable = input.commit !== null && !input.isDirty
    const cached = isCacheable ? this.cache.get(key) : undefined
    if (cached) {
      return cached
    }
    const now = (this.deps.now ?? Date.now)()
    const result = await this.runList(input)
    let entries: TestCatalogEntry[] = []
    let error: string | null = null
    if (result.code === 0) {
      try {
        entries = parsePlaywrightList(JSON.parse(getJsonOutput(result.stdout)), input)
      } catch {
        error = 'Playwright did not return a test list.'
      }
    } else {
      error = `${result.stderr}${result.stdout}`.slice(-ERROR_TAIL) || 'Listing the tests failed.'
    }
    const serial = findSerialFiles(
      input.repoRoot,
      entries.map((entry) => entry.file)
    )
    const catalog: TestCatalog = {
      sourceCommit: input.commit,
      configFile: input.configFile,
      entries: entries.map((entry) => ({ ...entry, isSerial: serial.has(entry.file) })),
      error,
      builtAt: now
    }
    if (!error && isCacheable) {
      this.cache.set(key, catalog)
    }
    return catalog
  }

  private runList(input: {
    cwd: string
    cli: string
    env: Record<string, string>
    configFile: string
  }): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env, ...input.env, ELECTRON_RUN_AS_NODE: '1' }
    // Why: a list must never be recorded as a run or wait for the run lock.
    delete env.ORCA_PLAYWRIGHT_REPORTER
    delete env.ORCA_PLAYWRIGHT_LOCK
    const child = (this.deps.spawn ?? spawnProcess)({
      program: process.execPath,
      args: [input.cli, 'test', '--list', '--reporter=json', '-c', input.configFile],
      cwd: input.cwd,
      env,
      stdio: 'pipe'
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve({ code: null, stdout, stderr: `${stderr}\nListing the tests timed out.` })
      }, LIST_TIMEOUT_MS)
      child.once('error', (error) => {
        clearTimeout(timer)
        resolve({ code: null, stdout, stderr: error.message })
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
    })
  }
}
