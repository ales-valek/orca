// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HulyConnectDialog } from './huly-connect-dialog'

const TOKEN = 'typed-secret-token'
const connect = vi.fn()

beforeEach(() => {
  connect.mockReset()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dialog only calls huly.connect, which this fake implements.
  window.api = { huly: { connect } } as unknown as typeof window.api
})
afterEach(cleanup)

function renderDialog(open = true) {
  const props = { onOpenChange: vi.fn(), onConnected: vi.fn() }
  const view = render(<HulyConnectDialog open={open} {...props} />)
  return {
    ...props,
    rerender: (next: boolean) => view.rerender(<HulyConnectDialog open={next} {...props} />)
  }
}

function submit(): void {
  fireEvent.change(screen.getByLabelText('Server URL'), {
    target: { value: 'https://huly.example.com' }
  })
  fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ordermage' } })
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: TOKEN } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
}

describe('HulyConnectDialog', () => {
  it('drops the token after a failed connect and keeps the other fields', async () => {
    connect.mockRejectedValue(
      new Error("Error invoking remote method 'huly:connect': Error: huly_auth_required")
    )
    renderDialog()
    submit()

    expect((await screen.findByRole('alert')).textContent).toBe('Huly rejected this token.')
    expect(screen.getByLabelText('Token')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Workspace')).toHaveProperty('value', 'ordermage')
  })

  it('never shows the typed token in an unexpected connect error', async () => {
    connect.mockRejectedValue(
      new Error(`Error invoking remote method 'huly:connect': Error: socket closed (${TOKEN})`)
    )
    renderDialog()
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not connect to Huly')
    expect(alert.textContent).not.toContain(TOKEN)
  })

  it('starts with an empty token after closing and reopening', () => {
    const dialog = renderDialog()
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: TOKEN } })

    dialog.rerender(false)
    dialog.rerender(true)

    expect(screen.getByLabelText('Token')).toHaveProperty('value', '')
  })
})
