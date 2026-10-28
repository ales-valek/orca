// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'

vi.mock('@/components/ui/select', () => import('@/components/ui/select-test-double'))

import {
  getEffectiveOrchestratorRepoId,
  MissionOrchestratorRepoPicker
} from './MissionOrchestratorRepoPicker'

function makeRepo(id: string): Repo {
  return { id, path: `/repos/${id}`, displayName: id, badgeColor: '#737373', addedAt: 0 }
}

const repos = [makeRepo('eshop'), makeRepo('admin'), makeRepo('orchestrator')]
let root: Root | null = null

function renderPicker(memberRepoIds: string[], value: string | null, onChange = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <MissionOrchestratorRepoPicker
        eligibleRepos={repos}
        memberRepoIds={new Set(memberRepoIds)}
        value={value}
        onChange={onChange}
      />
    )
  })
  return container
}

describe('MissionOrchestratorRepoPicker', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.replaceChildren()
  })

  it('offers None plus only the eligible repos that are not members', () => {
    const container = renderPicker(['eshop'], null)
    const options = [...container.querySelectorAll('[role="option"]')].map((option) =>
      option.getAttribute('data-value')
    )
    expect(options).toEqual(['__no-orchestrator__', 'admin', 'orchestrator'])
  })

  it('reports None as null and a repo pick as its id', () => {
    const onChange = vi.fn()
    const container = renderPicker([], 'admin', onChange)
    act(() => container.querySelector<HTMLElement>('[data-value="orchestrator"]')?.click())
    act(() => container.querySelector<HTMLElement>('[data-value="__no-orchestrator__"]')?.click())
    expect(onChange.mock.calls).toEqual([['orchestrator'], [null]])
  })

  it('shows None when the picked repo has since become a member', () => {
    const container = renderPicker(['admin'], 'admin')
    expect(container.querySelector('[data-slot="select"]')?.getAttribute('data-value')).toBe(
      '__no-orchestrator__'
    )
  })
})

describe('getEffectiveOrchestratorRepoId', () => {
  it('drops a pick that became a member and keeps any other pick', () => {
    expect(getEffectiveOrchestratorRepoId('admin', new Set(['admin']))).toBeNull()
    expect(getEffectiveOrchestratorRepoId('admin', new Set(['eshop']))).toBe('admin')
    expect(getEffectiveOrchestratorRepoId(null, new Set())).toBeNull()
  })
})
