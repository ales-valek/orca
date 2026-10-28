import React, { createContext, useContext, useMemo } from 'react'

// Why: Radix Select needs pointer capture and layout that happy-dom lacks; tests drive this flat stand-in.
const SelectContext = createContext<{
  value?: string
  onValueChange?: (value: string) => void
}>({})

export function Select({
  value,
  onValueChange,
  children
}: {
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  const contextValue = useMemo(() => ({ value, onValueChange }), [value, onValueChange])
  return (
    <SelectContext.Provider value={contextValue}>
      <div data-slot="select" data-value={value}>
        {children}
      </div>
    </SelectContext.Provider>
  )
}

export function SelectTrigger({
  children,
  ...props
}: React.ComponentProps<'button'> & { size?: string; density?: string }): React.JSX.Element {
  const { size: _size, density: _density, ...buttonProps } = props
  return (
    <button type="button" role="combobox" {...buttonProps}>
      {children}
    </button>
  )
}

export function SelectValue({ placeholder }: { placeholder?: string }): React.JSX.Element {
  const { value } = useContext(SelectContext)
  return <span data-slot="select-value">{value || placeholder}</span>
}

export function SelectContent({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div data-slot="select-content">{children}</div>
}

export function SelectItem({
  value,
  children
}: {
  value: string
  children: React.ReactNode
}): React.JSX.Element {
  const { onValueChange } = useContext(SelectContext)
  return (
    <button type="button" role="option" data-value={value} onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  )
}
