// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RepositoryIconColorSection } from './RepositoryIconColorSection'

let container: HTMLDivElement
let root: Root

function renderSection(sidebarHighlight: boolean) {
  const onSidebarHighlightChange = vi.fn()
  act(() => {
    root.render(
      <RepositoryIconColorSection
        badgeColor="#22c55e"
        onBadgeColorChange={vi.fn()}
        sidebarHighlight={sidebarHighlight}
        onSidebarHighlightChange={onSidebarHighlightChange}
      />
    )
  })
  const toggle = container.querySelector<HTMLButtonElement>(
    'button[role="switch"][aria-label="Highlight project in sidebar"]'
  )
  return { onSidebarHighlightChange, toggle }
}

describe('RepositoryIconColorSection sidebar highlight', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('turns the highlight on from the off state', () => {
    const { onSidebarHighlightChange, toggle } = renderSection(false)
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    act(() => toggle?.click())
    expect(onSidebarHighlightChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('turns the highlight off from the on state', () => {
    const { onSidebarHighlightChange, toggle } = renderSection(true)
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    act(() => toggle?.click())
    expect(onSidebarHighlightChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})
