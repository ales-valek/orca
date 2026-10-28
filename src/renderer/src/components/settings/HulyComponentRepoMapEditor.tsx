import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { HulyComponent } from '../../../../shared/huly/huly-types'
import type { Repo } from '../../../../shared/repo-types'

const NOT_MAPPED_VALUE = '__huly_not_mapped__'

type HulyComponentRepoMapEditorProps = {
  components: readonly HulyComponent[]
  repos: readonly Pick<Repo, 'id' | 'displayName'>[]
  /** Huly component id -> Orca repo id. */
  map: Record<string, string>
  onChange: (map: Record<string, string>) => void
}

export function HulyComponentRepoMapEditor({
  components,
  repos,
  map,
  onChange
}: HulyComponentRepoMapEditorProps): React.JSX.Element {
  if (components.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.HulyComponentRepoMapEditor.empty',
          'This project has no components. Issues without a component need a repository picked when creating a Mission.'
        )}
      </p>
    )
  }

  const setRepo = (componentId: string, value: string): void => {
    const next = { ...map }
    if (value === NOT_MAPPED_VALUE) {
      delete next[componentId]
    } else {
      next[componentId] = value
    }
    onChange(next)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
      {components.map((component) => {
        const repoId = map[component.id]
        const isRepoMissing = repoId !== undefined && !repos.some((repo) => repo.id === repoId)
        return (
          <div key={component.id} className="contents">
            <span className="truncate text-xs text-foreground">{component.label}</span>
            <Select
              value={repoId ?? NOT_MAPPED_VALUE}
              onValueChange={(value) => setRepo(component.id, value)}
            >
              <SelectTrigger
                size="sm"
                density="compact"
                className="w-full"
                aria-label={translate(
                  'auto.components.settings.HulyComponentRepoMapEditor.repoLabel',
                  'Repository for {{component}}',
                  { component: component.label }
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_MAPPED_VALUE}>
                  {translate(
                    'auto.components.settings.HulyComponentRepoMapEditor.notMapped',
                    'Not mapped'
                  )}
                </SelectItem>
                {repos.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.displayName}
                  </SelectItem>
                ))}
                {isRepoMissing ? (
                  <SelectItem value={repoId}>
                    {translate(
                      'auto.components.settings.HulyComponentRepoMapEditor.missingRepo',
                      'Missing repository'
                    )}
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}
