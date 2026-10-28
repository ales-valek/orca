import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type HulyMultiSelectOption = { value: string; label: string }

type HulyMultiSelectProps = {
  options: readonly HulyMultiSelectOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  placeholder: string
  ariaLabel: string
}

/** Compact checklist picker for status names and categories. */
export function HulyMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  ariaLabel
}: HulyMultiSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)
  // Keep saved values visible even when the workspace no longer lists them.
  const allOptions = [
    ...options,
    ...selected
      .filter((value) => !options.some((option) => option.value === value))
      .map((value) => ({ value, label: value }))
  ]
  const selectedLabels = allOptions
    .filter((option) => selectedSet.has(option.value))
    .map((option) => option.label)

  const toggle = (value: string): void => {
    onChange(
      selectedSet.has(value) ? selected.filter((entry) => entry !== value) : [...selected, value]
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full min-w-0 justify-between"
        >
          <span
            className={cn(
              'truncate text-xs font-normal',
              selectedLabels.length === 0 && 'text-muted-foreground'
            )}
          >
            {selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(280px,calc(100vw-1rem))] min-w-[var(--radix-popover-trigger-width)]"
      >
        <Command>
          <CommandList>
            {allOptions.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                onSelect={() => toggle(option.value)}
                className="items-center gap-2 px-3 py-1.5 text-xs"
              >
                <Check
                  className={cn(
                    'size-3 text-muted-foreground',
                    selectedSet.has(option.value) ? 'opacity-70' : 'opacity-0'
                  )}
                />
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
