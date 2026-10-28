import { describe, expect, it } from 'vitest'
import {
  buildZeroContextPatch,
  mapHunkOntoLayer,
  parseZeroContextDiff,
  type ZeroContextHunk
} from './mission-absorb-patch'

function hunk(oldStart: number, oldCount: number, newStart: number, newCount: number) {
  return { oldStart, oldCount, newStart, newCount, lines: [] } satisfies ZeroContextHunk
}

describe('mapHunkOntoLayer', () => {
  it('moves a hunk by the lines layers above added or removed before it', () => {
    // Layer to preview: 2 lines added at the top, 1 line removed after preview line 5.
    const layerToPreview = [hunk(0, 0, 1, 2), hunk(4, 1, 5, 0)]

    expect(mapHunkOntoLayer(hunk(8, 1, 8, 1), layerToPreview)?.oldStart).toBe(7)
  })

  it('refuses lines that layers above changed or split', () => {
    expect(mapHunkOntoLayer(hunk(3, 2, 3, 2), [hunk(3, 1, 4, 1)])).toBeNull()
    expect(mapHunkOntoLayer(hunk(3, 2, 3, 2), [hunk(4, 1, 3, 0)])).toBeNull()
  })
})

describe('buildZeroContextPatch', () => {
  it('renumbers the new side for the chosen hunks only', () => {
    const { header, hunks } = parseZeroContextDiff(
      [
        'diff --git a/f b/f',
        '--- a/f',
        '+++ b/f',
        '@@ -1,0 +2,2 @@',
        '+a',
        '+b',
        '@@ -5 +7,0 @@',
        '-gone',
        '@@ -9 +10 @@',
        '-old',
        '+new',
        ''
      ].join('\n')
    )

    expect(buildZeroContextPatch(header, [hunks[1]!, hunks[2]!])).toBe(
      [
        'diff --git a/f b/f',
        '--- a/f',
        '+++ b/f',
        '@@ -5,1 +4,0 @@',
        '-gone',
        '@@ -9,1 +8,1 @@',
        '-old',
        '+new',
        ''
      ].join('\n')
    )
  })
})
