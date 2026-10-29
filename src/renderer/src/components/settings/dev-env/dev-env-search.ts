import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { searchKeywords } from '../settings-search-keywords'

export const getDevEnvPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('devEnv.search.title', 'Dev Environments'),
    description: translate(
      'devEnv.search.description',
      'Shared Docker infra, templates, env files, ports and secrets for missions and worktrees.'
    ),
    keywords: searchKeywords([
      { key: 'devEnv.search.docker', fallback: 'docker', englishOnly: true },
      { key: 'devEnv.search.infra', fallback: 'infra' },
      { key: 'devEnv.search.template', fallback: 'template' },
      { key: 'devEnv.search.env', fallback: 'env', englishOnly: true },
      { key: 'devEnv.search.ports', fallback: 'ports' },
      { key: 'devEnv.search.services', fallback: 'services' },
      { key: 'devEnv.search.secrets', fallback: 'secrets' },
      { key: 'devEnv.search.compose', fallback: 'compose', englishOnly: true }
    ])
  }
])
