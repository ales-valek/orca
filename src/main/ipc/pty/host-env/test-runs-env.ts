import { join } from 'node:path'
import {
  ORCA_PLAYWRIGHT_REPORTER_ENV,
  ORCA_TEST_RUNS_DIR_ENV
} from '../../../../shared/test-runs/test-run-types'
import { ORCA_PLAYWRIGHT_REPORTER_FILE, getTestRunsDir } from '../../../test-runs/test-runs-install'

/** Lets a test repo's opt-in config hand its Playwright runs to Orca. */
export function applyTestRunsEnv(
  env: Record<string, string>,
  options: { userDataPath: string; isWsl: boolean }
): void {
  // Why: host paths mean nothing inside a WSL guest.
  if (options.isWsl) {
    delete env[ORCA_TEST_RUNS_DIR_ENV]
    delete env[ORCA_PLAYWRIGHT_REPORTER_ENV]
    return
  }
  // Why overwrite: an inherited value belongs to the Orca instance that launched this one.
  const dir = getTestRunsDir(options.userDataPath)
  env[ORCA_TEST_RUNS_DIR_ENV] = dir
  env[ORCA_PLAYWRIGHT_REPORTER_ENV] = join(dir, ORCA_PLAYWRIGHT_REPORTER_FILE)
}
