import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeMissionBrief } from './mission-brief-file'
import { ensureMissionRoot } from './mission-root'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'mission-brief-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('writeMissionBrief', () => {
  it('replaces MISSION.md inside an owned root without leaving temp files', () => {
    const baseDir = path.join(tmp, 'missions')
    const root = { baseDir, rootPath: path.join(baseDir, 'kiosek'), missionId: 'mission-1' }
    ensureMissionRoot({ ...root, links: [] })

    writeMissionBrief(root, '# one\n')
    writeMissionBrief(root, '# two\n')

    expect(readFileSync(path.join(root.rootPath, 'MISSION.md'), 'utf8')).toBe('# two\n')
    expect(readdirSync(root.rootPath).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('refuses a directory Orca does not own', () => {
    const baseDir = path.join(tmp, 'missions')
    const rootPath = path.join(baseDir, 'foreign')
    mkdirSync(rootPath, { recursive: true })
    writeFileSync(path.join(rootPath, 'keep.txt'), 'x')

    expect(() => writeMissionBrief({ baseDir, rootPath, missionId: 'mission-1' }, '# x')).toThrow()
    expect(readdirSync(rootPath)).toEqual(['keep.txt'])
  })
})
