import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getOrcaPlaywrightReporterSource } from './orca-playwright-reporter-source'

export const ORCA_PLAYWRIGHT_REPORTER_FILE = 'orca-playwright-reporter.cjs'

export function getTestRunsDir(userDataPath: string): string {
  return join(userDataPath, 'test-runs')
}

/** Keeps the reporter file in step with this Orca build; returns its path. */
export function installOrcaPlaywrightReporter(dir: string): string {
  const path = join(dir, ORCA_PLAYWRIGHT_REPORTER_FILE)
  const source = getOrcaPlaywrightReporterSource()
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
