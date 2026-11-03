import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './section-layout/SearchableSetting'
import { SettingsSwitchRow } from './form-controls/SettingsFormControls'

type DiffLanguageIntelligenceSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function DiffLanguageIntelligenceSetting({
  settings,
  updateSettings
}: DiffLanguageIntelligenceSettingProps): React.JSX.Element {
  const title = translate(
    'auto.components.settings.GeneralEditorSettingsSection.diffLanguageIntelligence',
    'Language Intelligence in Diffs'
  )
  const description = translate(
    'auto.components.settings.GeneralEditorSettingsSection.diffLanguageIntelligenceDesc',
    'Show TypeScript and ESLint diagnostics, language server hovers and line blame in diffs. Turn off to review very large diffs faster.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['diff', 'lsp', 'eslint', 'typescript', 'diagnostics', 'performance']}
    >
      <SettingsSwitchRow
        label={title}
        description={description}
        checked={settings.diffLanguageIntelligenceEnabled !== false}
        onChange={() =>
          updateSettings({
            diffLanguageIntelligenceEnabled: settings.diffLanguageIntelligenceEnabled === false
          })
        }
      />
    </SearchableSetting>
  )
}
