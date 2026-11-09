import { getDefaultDevEnvSettings } from './dev-env/dev-env-settings'

export function getForkDefaultGlobalSettings() {
  return {
    workspaceSidebarPosition: 'left' as const,
    editorGitLineBlameEnabled: true,
    editorChangedLineHighlightsEnabled: true,
    diffLanguageIntelligenceEnabled: true,
    folderColorOverrides: {},
    customCssEnabled: false,
    hulyProjects: {},
    ...getDefaultDevEnvSettings()
  }
}
