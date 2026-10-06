/** ESLint's server waits for this reply before it will lint. 4 is "approved". */
const ESLINT_EXECUTION_APPROVED = 4

/** Null lets the server probe flat config vs legacy eslintrc in the project. */
const ESLINT_WORKSPACE_SETTINGS = {
  validate: 'on',
  run: 'onType',
  useFlatConfig: null,
  experimental: { useFlatConfig: null },
  quiet: false,
  onIgnoredFiles: 'off',
  problems: { shortenToSingleLine: false },
  codeAction: {
    disableRuleComment: { enable: true, location: 'separateLine' },
    showDocumentation: { enable: true }
  },
  format: false,
  workingDirectories: null,
  rulesCustomizations: []
}

function configurationItem(item: unknown): unknown {
  if (!item || typeof item !== 'object' || !('section' in item)) {
    return null
  }
  return item.section === 'eslint' ? ESLINT_WORKSPACE_SETTINGS : null
}

/** Reply to a server→client request. ESLint needs its settings and an
 *  execution approval; every other request still gets null. */
export function answerLspServerRequest(method: string, params: unknown): unknown {
  if (method === 'eslint/confirmESLintExecution') {
    return ESLINT_EXECUTION_APPROVED
  }
  if (method !== 'workspace/configuration') {
    return null
  }
  const items = (params as { items?: unknown[] } | undefined)?.items
  return Array.isArray(items) ? items.map(configurationItem) : null
}
