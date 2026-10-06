import type { languages } from 'monaco-editor'

// Why: Monaco's TS/JS grammar sets defaultToken to "invalid" (red) and has no
// decorator rule, so `@Component` falls through and the "@" paints as an error.
const DECORATOR_RULE: languages.IMonarchLanguageRule = [/@[a-zA-Z_$][\w$]*/, 'keyword']

export function withDecoratorToken(
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
      common: [DECORATOR_RULE, ...common]
    }
  }
}
