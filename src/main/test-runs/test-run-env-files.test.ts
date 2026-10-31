import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyMissingEnvFiles } from './test-run-env-files'

describe('copyMissingEnvFiles', () => {
  it('copies env files the source lacks and leaves its own and examples alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-env-files-'))
    const from = join(root, 'from')
    const source = join(root, 'source')
    mkdirSync(from)
    mkdirSync(join(source, 'tests'), { recursive: true })
    writeFileSync(join(from, '.env'), 'shared')
    writeFileSync(join(from, '.env.dev'), 'dev')
    writeFileSync(join(from, '.env.example'), 'example')
    writeFileSync(join(from, 'notes.txt'), 'notes')
    writeFileSync(join(source, 'tests', '.env.dev'), 'own')

    expect(copyMissingEnvFiles({ from, to: 'tests' }, source)).toEqual({ copied: ['.env'] })
    expect(readFileSync(join(source, 'tests', '.env'), 'utf8')).toBe('shared')
    expect(readFileSync(join(source, 'tests', '.env.dev'), 'utf8')).toBe('own')
  })

  it('reports a missing folder', () => {
    expect(copyMissingEnvFiles({ from: '/nope/orca-env', to: 'tests' }, tmpdir())).toEqual({
      error: expect.stringContaining('/nope/orca-env')
    })
  })
})
