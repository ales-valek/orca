import { readFile, stat } from 'node:fs/promises'

const LOG_TAIL_BYTES = 200 * 1024

/** The end of a Dev Environments log; a missing log reads as empty. */
export async function readDevEnvLogTail(path: string): Promise<string> {
  try {
    const { size } = await stat(path)
    const text = await readFile(path, 'utf8')
    return size > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text
  } catch {
    return ''
  }
}
