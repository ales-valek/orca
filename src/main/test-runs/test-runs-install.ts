import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getOrcaPlaywrightLockSource } from './orca-playwright-lock-source'
import { getOrcaPlaywrightReporterSource } from './orca-playwright-reporter-source'

export const ORCA_PLAYWRIGHT_REPORTER_FILE = 'orca-playwright-reporter.cjs'
export const ORCA_PLAYWRIGHT_LOCK_FILE = 'orca-playwright-lock.cjs'

export function getTestRunsDir(userDataPath: string): string {
  return join(userDataPath, 'test-runs')
}

/** Keeps a generated file in step with this Orca build; returns its path. */
function installGeneratedFile(dir: string, name: string, source: string): string {
  const path = join(dir, name)
  let current: string | null = null
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    current = null
  }
  if (current !== source) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, source)
  }
  return path
}

export function installOrcaPlaywrightReporter(dir: string): string {
  return installGeneratedFile(dir, ORCA_PLAYWRIGHT_REPORTER_FILE, getOrcaPlaywrightReporterSource())
}

export function installOrcaPlaywrightLock(dir: string): string {
  return installGeneratedFile(dir, ORCA_PLAYWRIGHT_LOCK_FILE, getOrcaPlaywrightLockSource())
}
