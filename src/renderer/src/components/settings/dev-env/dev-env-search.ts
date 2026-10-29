import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getDevEnvPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('devEnv.search.title', 'Dev Environments'),
    description: translate(
      'devEnv.search.description',
      'Shared Docker infra, templates, env files, ports and secrets for missions and worktrees.'
    ),
    keywords: ['docker', 'infra', 'template', 'env', 'ports', 'services', 'secrets', 'compose']
  }
])
