import { closeSync, existsSync, openSync, readSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOG_TAIL_BYTES = 64 * 1024
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Launch logs older than a week; their runs are in the run store. */
export function removeOldLaunchLogs(dir: string): void {
  if (!existsSync(dir)) {
    return
  }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    try {
      if (Date.now() - statSync(path).mtimeMs > LOG_MAX_AGE_MS) {
        rmSync(path, { force: true })
      }
    } catch {
      // A log another process removed first is gone either way.
    }
  }
}

/** The end of a launch log, read without loading the whole file. */
export function readLogTail(path: string): string {
  try {
    const size = statSync(path).size
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, length, size - length)
    } finally {
      closeSync(fd)
    }
    return buffer.toString('utf8')
  } catch {
    return ''
  }
}
