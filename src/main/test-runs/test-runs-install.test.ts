import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getOrcaPlaywrightReporterSource } from './orca-playwright-reporter-source'
import { installOrcaPlaywrightReporter } from './test-runs-install'

let dir: string

describe('installOrcaPlaywrightReporter', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-runs-install-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the reporter once and rewrites it when the source changes', () => {
    const path = installOrcaPlaywrightReporter(dir)
    expect(path).toBe(join(dir, 'orca-playwright-reporter.cjs'))
    expect(readFileSync(path, 'utf8')).toBe(getOrcaPlaywrightReporterSource())

    const writtenAt = statSync(path).mtimeMs
    installOrcaPlaywrightReporter(dir)
    expect(statSync(path).mtimeMs).toBe(writtenAt)

    writeFileSync(path, 'stale')
    installOrcaPlaywrightReporter(dir)
    expect(readFileSync(path, 'utf8')).toBe(getOrcaPlaywrightReporterSource())
  })
})
