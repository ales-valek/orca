import { useEffect, useState } from 'react'

/** Whether a Huly workspace is connected, read once on mount; false where Huly is unavailable. */
export function useHulyConnected(): boolean {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let cancelled = false
    // The web client has no Huly bridge; a missing namespace rejects inside the chain.
    void Promise.resolve()
      .then(() => window.api.huly.status())
      .then(
        (status) => {
          if (!cancelled) {
            setConnected(status.connected)
          }
        },
        () => {}
      )
    return () => {
      cancelled = true
    }
  }, [])
  return connected
}
