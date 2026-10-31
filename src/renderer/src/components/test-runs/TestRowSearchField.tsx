import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

/** Search over test ids, titles, files and tags; Escape clears. */
export function TestRowSearchField({
  query,
  onQueryChange
}: {
  query: string
  onQueryChange: (query: string) => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasText = query !== ''
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        value={query}
        aria-label={translate('testRuns.search.label', 'Search tests')}
        placeholder={translate('testRuns.search.placeholder', 'Search id, title, file, @tag…')}
        data-escape-clears-value={hasText ? 'true' : undefined}
        className={cn(
          'h-7 border-border bg-background pl-8 text-xs shadow-none focus-visible:border-ring/70 focus-visible:ring-0 dark:bg-background',
          hasText && 'pr-7'
        )}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && hasText) {
            event.preventDefault()
            onQueryChange('')
          }
        }}
      />
      {hasText ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label={translate('testRuns.search.clear', 'Clear search')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onQueryChange('')
            inputRef.current?.focus()
          }}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
