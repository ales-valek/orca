import { describe, expect, it } from 'vitest'
import { getHulyProjectSettings } from './huly-project-settings'
import { resolveStatusTransition } from './huly-status-rules'

const RULES = getHulyProjectSettings({}, 'OMP').statusRules

describe('resolveStatusTransition', () => {
  it('moves a reviewed issue to testing when its stack merged', () => {
    expect(
      resolveStatusTransition(RULES['stack-merged'], { name: 'CODE REVIEW', category: 'Active' })
    ).toBe('TESTOVÁNÍ')
  })

  it('leaves an issue the user moved to staging by hand', () => {
    expect(
      resolveStatusTransition(RULES['stack-merged'], {
        name: 'Staging Testování',
        category: 'Active'
      })
    ).toBeNull()
  })

  it('leaves a blocked issue when its layer is created', () => {
    expect(
      resolveStatusTransition(RULES['layer-created'], { name: 'BLOCKED', category: 'Active' })
    ).toBeNull()
  })

  it('fires on a from-category and matches from-names case-insensitively', () => {
    expect(
      resolveStatusTransition(RULES['layer-created'], { name: 'Backlog', category: 'UnStarted' })
    ).toBe('In Progress')
    expect(
      resolveStatusTransition(RULES['stack-pr-created'], {
        name: 'in progress',
        category: 'Active'
      })
    ).toBe('CODE REVIEW')
  })

  it('never writes for a rule without a target', () => {
    expect(
      resolveStatusTransition(
        { target: null, fromStatusNames: ['Todo'], fromCategories: ['ToDo'] },
        { name: 'Todo', category: 'ToDo' }
      )
    ).toBeNull()
  })

  it('never rewrites the status the issue already has', () => {
    expect(
      resolveStatusTransition(
        { target: 'Todo', fromStatusNames: [], fromCategories: ['ToDo'] },
        { name: 'todo', category: 'ToDo' }
      )
    ).toBeNull()
  })
})
