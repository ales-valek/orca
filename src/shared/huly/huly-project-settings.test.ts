import { describe, expect, it } from 'vitest'
import { getHulyProjectSettings, normalizeHulyProjects } from './huly-project-settings'

describe('getHulyProjectSettings', () => {
  it('returns the default rules and skip list for an unknown project', () => {
    expect(getHulyProjectSettings({ hulyProjects: {} }, 'OMP')).toEqual({
      componentRepoMap: {},
      skipStatusNames: ['MERGED IN MILESTONE'],
      statusWriteBack: false,
      statusRules: {
        'layer-created': {
          target: 'In Progress',
          fromStatusNames: [],
          fromCategories: ['UnStarted', 'ToDo']
        },
        'stack-pr-created': {
          target: 'CODE REVIEW',
          fromStatusNames: ['In Progress', 'Rozpracováno'],
          fromCategories: []
        },
        'stack-merged': {
          target: 'TESTOVÁNÍ',
          fromStatusNames: ['CODE REVIEW', 'Review in progress'],
          fromCategories: []
        }
      }
    })
  })

  it('returns stored settings for a known project', () => {
    const hulyProjects = normalizeHulyProjects({ OMP: { statusWriteBack: true } })
    expect(getHulyProjectSettings({ hulyProjects }, 'OMP').statusWriteBack).toBe(true)
  })
})

describe('normalizeHulyProjects', () => {
  it('drops non-string map entries and keeps valid ones', () => {
    const result = normalizeHulyProjects({
      OMP: { componentRepoMap: { c1: 'repo-1', c2: 7, c3: null } },
      BAD: 'nope'
    })
    expect(Object.keys(result)).toEqual(['OMP'])
    expect(result.OMP.componentRepoMap).toEqual({ c1: 'repo-1' })
  })

  it('fills a missing statusRules key from the defaults', () => {
    const result = normalizeHulyProjects({ OMP: { skipStatusNames: ['X'] } })
    expect(result.OMP.skipStatusNames).toEqual(['X'])
    expect(result.OMP.statusRules['stack-merged'].target).toBe('TESTOVÁNÍ')
  })

  it('keeps a null target and validates categories against the allowlist', () => {
    const result = normalizeHulyProjects({
      OMP: {
        statusRules: {
          'layer-created': {
            target: null,
            fromStatusNames: ['A', 1],
            fromCategories: ['Active', 'Bogus']
          }
        }
      }
    })
    expect(result.OMP.statusRules['layer-created']).toEqual({
      target: null,
      fromStatusNames: ['A'],
      fromCategories: ['Active']
    })
    expect(result.OMP.statusRules['stack-pr-created'].target).toBe('CODE REVIEW')
  })

  it('returns an empty record for non-object input', () => {
    expect(normalizeHulyProjects(undefined)).toEqual({})
    expect(normalizeHulyProjects([])).toEqual({})
  })
})
