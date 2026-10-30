import React, { useRef } from 'react'

/**
 * Keeps the Tools page mounted after its first visit and only hides it.
 * Why: removing a browser guest's parent destroys the guest, so tool tabs would reload on return.
 */
export function DevToolsPageHost({
  isActive,
  children
}: {
  isActive: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  const visitedRef = useRef(false)
  if (isActive) {
    visitedRef.current = true
  }
  if (!visitedRef.current) {
    return null
  }
  return (
    <div
      className={isActive ? 'flex flex-1 min-w-0 min-h-0' : 'hidden flex-1 min-w-0 min-h-0'}
      inert={!isActive}
      aria-hidden={!isActive}
      data-dev-tools-page-host=""
    >
      {children}
    </div>
  )
}
