import { describe, expect, it } from 'vitest'
import { planAbsorb, type AbsorbHunk, type AbsorbLayerRange } from './mission-absorb-plan'

const layers: AbsorbLayerRange[] = [
  { taskId: 't1', commits: ['c1-new', 'c1-old'] },
  { taskId: 't2', commits: ['c2'] }
]

function hunk(file: string, touchedOldLines: number[]): AbsorbHunk {
  return { file, patch: `patch ${file}:${touchedOldLines.join(',')}`, touchedOldLines }
}

const blameByFile = new Map([
  [
    'app.ts',
    new Map([
      [1, 'c1-old'],
      [2, 'c1-new'],
      [3, 'c2'],
      [4, 'mission-commit']
    ])
  ]
])

describe('planAbsorb', () => {
  it('gives a hunk whose lines all blame to one layer to that layer, fixing up its newest commit', () => {
    const edit = hunk('app.ts', [1, 2])

    expect(planAbsorb([edit], blameByFile, layers, 't2')).toEqual({
      assignments: [{ hunk: edit, taskId: 't1', fixupOf: 'c1-new' }],
      ambiguous: []
    })
  })

  it('gives a pure addition and lines outside every layer to the top task tip', () => {
    const addition = hunk('app.ts', [])
    const missionLine = hunk('app.ts', [4])

    expect(planAbsorb([addition, missionLine], blameByFile, layers, 't2').assignments).toEqual([
      { hunk: addition, taskId: 't2', fixupOf: 'c2' },
      { hunk: missionLine, taskId: 't2', fixupOf: 'c2' }
    ])
  })

  it('commits a pure addition plainly when the top task has no commits', () => {
    const addition = hunk('new.ts', [])
    const empty = [...layers, { taskId: 't3', commits: [] }]

    expect(planAbsorb([addition], blameByFile, empty, 't3').assignments).toEqual([
      { hunk: addition, taskId: 't3', fixupOf: null }
    ])
  })

  it('reports a hunk spanning two layers as ambiguous', () => {
    const spanning = hunk('app.ts', [2, 3])

    expect(planAbsorb([spanning], blameByFile, layers, 't2')).toEqual({
      assignments: [],
      ambiguous: [{ hunk: spanning, candidateTaskIds: ['t1', 't2'] }]
    })
  })

  it('assigns an ambiguous hunk to the layer the user chose', () => {
    const spanning = hunk('app.ts', [2, 3])

    const plan = planAbsorb([spanning], blameByFile, layers, 't2', new Map([['app.ts:2', 't1']]))

    expect(plan).toEqual({
      assignments: [{ hunk: spanning, taskId: 't1', fixupOf: 'c1-new' }],
      ambiguous: []
    })
  })

  it('never places an opaque change or an unblamed line by itself', () => {
    const deleted: AbsorbHunk = { ...hunk('gone.ts', []), opaque: true }
    const unblamed = hunk('other.ts', [7])

    expect(planAbsorb([deleted, unblamed], blameByFile, layers, 't2').ambiguous).toEqual([
      { hunk: deleted, candidateTaskIds: ['t1', 't2'] },
      { hunk: unblamed, candidateTaskIds: ['t1', 't2'] }
    ])
  })
})
