// @vitest-environment happy-dom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DevToolsPageHost } from './DevToolsPageHost'

function page(isActive: boolean) {
  return (
    <DevToolsPageHost isActive={isActive}>
      <div data-testid="tools-page">tools</div>
    </DevToolsPageHost>
  )
}

describe('DevToolsPageHost', () => {
  it('mounts on first visit and keeps the same page node, only hidden, while away', () => {
    const view = render(page(false))
    expect(view.queryByTestId('tools-page')).toBeNull()

    view.rerender(page(true))
    const mounted = view.getByTestId('tools-page')
    expect(mounted.closest('[data-dev-tools-page-host]')?.getAttribute('aria-hidden')).toBe('false')

    view.rerender(page(false))
    expect(view.getByTestId('tools-page')).toBe(mounted)
    expect(mounted.closest('[data-dev-tools-page-host]')?.getAttribute('aria-hidden')).toBe('true')

    view.rerender(page(true))
    expect(view.getByTestId('tools-page')).toBe(mounted)
  })
})
