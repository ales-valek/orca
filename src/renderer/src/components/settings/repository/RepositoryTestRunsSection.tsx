import { translate } from '@/i18n/i18n'
import React, { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { Repo } from '../../../../../shared/repo-types'
import type { RepoTestRunSettings } from '../../../../../shared/test-runs/repo-test-run-settings'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import type { SettingsSearchEntry } from '../search/settings-search'

export const REPOSITORY_TEST_RUNS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    title: 'Tests',
    description: 'How the Tests panel reads this repo’s Playwright tests.',
    keywords: ['playwright', 'e2e', 'tier', 'tiers', 'bug-pin', 'known bug', 'test runs']
  }
]

/** Tier folders and known-bug annotations of one repo's Playwright tests. */
export function RepositoryTestRunsSection({
  repo,
  updateRepo
}: {
  repo: Repo
  updateRepo: (repoId: string, updates: Partial<Repo>) => void
}): React.JSX.Element {
  const settings = repo.testRuns ?? {}
  const [tierPattern, setTierPattern] = useState(settings.tierPattern ?? '')
  const [annotations, setAnnotations] = useState((settings.knownBugAnnotations ?? []).join(', '))
  useEffect(() => {
    setTierPattern(repo.testRuns?.tierPattern ?? '')
    setAnnotations((repo.testRuns?.knownBugAnnotations ?? []).join(', '))
  }, [repo.testRuns])

  const save = (changes: Partial<RepoTestRunSettings>): void =>
    updateRepo(repo.id, { testRuns: { ...settings, ...changes } })

  return (
    <SearchableSetting
      title={translate('testRuns.repoSettings.title', 'Tests')}
      description={translate(
        'testRuns.repoSettings.description',
        'How the Tests panel reads this repo’s Playwright tests.'
      )}
      keywords={[repo.displayName, 'playwright', 'e2e', 'tier', 'bug-pin']}
      className="space-y-3"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {translate('testRuns.repoSettings.title', 'Tests')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'testRuns.repoSettings.description',
            'How the Tests panel reads this repo’s Playwright tests.'
          )}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span>{translate('testRuns.repoSettings.tierPattern', 'Tier folder pattern')}</span>
        <Input
          value={tierPattern}
          placeholder="(?:^|/)tier-(\d+)/"
          onChange={(event) => setTierPattern(event.target.value)}
          onBlur={() => save({ tierPattern: tierPattern.trim() || undefined })}
        />
        <span className="text-muted-foreground">
          {translate(
            'testRuns.repoSettings.tierPatternHelp',
            'A regular expression matched against test file paths; its first group is the tier number.'
          )}
        </span>
      </label>
      <label className="flex items-center justify-between gap-4 text-xs">
        <span>
          {translate('testRuns.repoSettings.cumulative', 'Higher tiers include lower ones')}
        </span>
        <Switch
          checked={settings.cumulativeTiers === true}
          onCheckedChange={(cumulativeTiers) => save({ cumulativeTiers })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span>{translate('testRuns.repoSettings.knownBugs', 'Known-bug annotation types')}</span>
        <Input
          value={annotations}
          placeholder="bug-pin"
          onChange={(event) => setAnnotations(event.target.value)}
          onBlur={() =>
            save({
              knownBugAnnotations: annotations
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean)
            })
          }
        />
      </label>
    </SearchableSetting>
  )
}
