import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BULLMQ_META_KEY_PATTERN,
  getBullmqDashboardSource,
  parseBullmqMetaKey
} from './dev-tools-bullmq-dashboard'

describe('BullMQ dashboard', () => {
  it('reads prefix and queue from BullMQ meta keys', () => {
    expect(parseBullmqMetaKey('kiosek-bull:media-processing:meta')).toEqual({
      prefix: 'kiosek-bull',
      queue: 'media-processing'
    })
    expect(parseBullmqMetaKey('bull:emails:meta')).toEqual({ prefix: 'bull', queue: 'emails' })
    expect(parseBullmqMetaKey('kiosek:OM:cache')).toBeNull()
  })

  it('ships a server script that parses and uses the same key pattern', () => {
    const source = getBullmqDashboardSource()
    expect(source).toContain(BULLMQ_META_KEY_PATTERN.source)
    // Why: bull-board keys queues by name; same-named queues of two environments would overwrite each other.
    expect(source).toContain("prefix: prefix + ':'")
    expect(source).toContain("delimiter: ':'")
    const dir = mkdtempSync(join(tmpdir(), 'orca-bullmq-'))
    try {
      const file = join(dir, 'server.mjs')
      writeFileSync(file, source)
      expect(() => execFileSync('node', ['--check', file], { stdio: 'pipe' })).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
