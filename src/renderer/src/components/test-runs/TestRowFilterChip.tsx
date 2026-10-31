import React from 'react'
import { Button } from '@/components/ui/button'

/** One filter of the Tests panel's list. */
export function TestRowFilterChip({
  isActive,
  onClick,
  children
}: {
  isActive: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      size="xs"
      variant={isActive ? 'secondary' : 'ghost'}
      aria-pressed={isActive}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
