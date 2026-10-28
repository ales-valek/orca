// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyHulyConnectionChanged } from '@/components/huly-connection-change-event'
import { useHulyConnected } from './use-huly-connected'

function Probe(): React.JSX.Element {
  return <span>{useHulyConnected() ? 'connected' : 'disconnected'}</span>
}

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('useHulyConnected', () => {
  it('re-reads the status after a connect or disconnect elsewhere', async () => {
    const status = vi.fn().mockResolvedValue({ connected: false })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook only calls huly.status, which this fake implements.
    window.api = { huly: { status } } as unknown as typeof window.api
    const container = document.createElement('div')
    document.body.append(container)

    await act(async () => {
      root = createRoot(container)
      root.render(<Probe />)
    })
    expect(container.textContent).toBe('disconnected')

    status.mockResolvedValue({
      connected: true,
      info: { serverUrl: 'https://huly.test', workspace: 'ordermage' }
    })
    await act(async () => notifyHulyConnectionChanged())
    expect(container.textContent).toBe('connected')

    status.mockResolvedValue({ connected: false })
    await act(async () => notifyHulyConnectionChanged())
    expect(container.textContent).toBe('disconnected')
    expect(status).toHaveBeenCalledTimes(3)
  })
})
