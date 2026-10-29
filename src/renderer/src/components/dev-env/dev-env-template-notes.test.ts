import { describe, expect, it } from 'vitest'
import type { DevEnvTemplate } from '../../../../shared/dev-env/dev-env-types'
import { getDevEnvTemplateNotes } from './dev-env-template-notes'

const TEMPLATE: DevEnvTemplate = {
  id: 't',
  name: 'T',
  dependencies: [],
  credentials: [],
  slots: [
    {
      name: 'eshop',
      repoId: 'r-eshop',
      install: [],
      envFiles: [],
      services: [{ name: 'eshop', command: 'c', portOffset: 1, dependsOn: [] }]
    },
    {
      name: 'blog-cms-fe',
      repoId: 'r-cms-fe',
      install: [],
      envFiles: [],
      services: [{ name: 'cms-ui', command: 'c', portOffset: 2, dependsOn: [] }]
    },
    { name: 'tests', repoId: null, install: [], envFiles: [], services: [] }
  ]
}

describe('getDevEnvTemplateNotes', () => {
  it('names slots whose repo is not in the mission and their services', () => {
    expect(getDevEnvTemplateNotes(TEMPLATE, ['r-eshop'])).toEqual([
      'Slot blog-cms-fe has no repo in this mission, so cms-ui will not start.'
    ])
  })

  it('has no notes when every slot repo is selected', () => {
    expect(getDevEnvTemplateNotes(TEMPLATE, ['r-eshop', 'r-cms-fe'])).toEqual([])
  })
})
