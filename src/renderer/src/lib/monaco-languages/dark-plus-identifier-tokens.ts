import type { languages } from 'monaco-editor'

// Why: the bundled TS/JS grammar emits `identifier` for every name, so theme
// rules for `variable` and `function` never match and names stay the default color.
const FUNCTION_BINDING: languages.IMonarchLanguageRule = [
  /#?[a-z_$][\w$]*(?=\s*=\s*(?:async\s*)?(?:<[^>\n]{0,80}>\s*)?(?:function\b|\())/,
  'function'
]

const FUNCTION_CALL: languages.IMonarchLanguageRule = [
  /#?[a-z_$][\w$]*(?=\s*(?:<[^;\n]{0,200}>\s*)?\()/,
  {
    cases: {
      '@keywords': 'keyword',
      '@default': 'function'
    }
  }
]

function classifyIdentifier(rule: languages.IMonarchLanguageRule): languages.IMonarchLanguageRule {
  if (!Array.isArray(rule)) {
    return rule
  }
  const [match, action] = rule
  if (!action || typeof action !== 'object' || !('cases' in action) || !action.cases) {
    return rule
  }
  const cases = action.cases as Record<string, string>
  if (cases['@default'] !== 'identifier') {
    return rule
  }
  return [match, { ...action, cases: { ...cases, '@default': 'variable' } }]
}

export function withDarkPlusIdentifierTokens(
  language: languages.IMonarchLanguage
): languages.IMonarchLanguage {
  const common = language.tokenizer.common
  if (!Array.isArray(common)) {
    return language
  }
  return {
    ...language,
    tokenizer: {
      ...language.tokenizer,
      common: [FUNCTION_BINDING, FUNCTION_CALL, ...common.map(classifyIdentifier)]
    }
  }
}
