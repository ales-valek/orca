import { useEffect, useState } from 'react'
import { HULY_CONNECTION_CHANGED_EVENT } from '@/components/huly-connection-change-event'

/** Whether a Huly workspace is connected, re-read after every connect or disconnect; false where Huly is unavailable. */
export function useHulyConnected(): boolean {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let cancelled = false
    let readId = 0
    const read = () => {
      const id = ++readId
      // The web client has no Huly bridge; a missing namespace rejects inside the chain.
      void Promise.resolve()
        .then(() => window.api.huly.status())
        .then(
          (status) => {
            if (!cancelled && id === readId) {
              setConnected(status.connected)
            }
          },
          () => {}
        )
    }
    read()
    window.addEventListener(HULY_CONNECTION_CHANGED_EVENT, read)
    return () => {
      cancelled = true
      window.removeEventListener(HULY_CONNECTION_CHANGED_EVENT, read)
    }
  }, [])
  return connected
}
