// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { language as typescriptLanguage } from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js'
import { withDecoratorToken } from './decorator-tokens'
import { withDarkPlusIdentifierTokens } from './dark-plus-identifier-tokens'
import {
  createMonarchTokenizer,
  tokenizeLines,
  tokenTypeAt,
  type TokenizedLine
} from './monarch-tokenizer-test-harness'

function typeOf(line: TokenizedLine, word: string): string {
  return tokenTypeAt(line, line.text.indexOf(word))
}

describe('withDarkPlusIdentifierTokens', () => {
  const tokenizer = createMonarchTokenizer(
    'typescript',
    withDarkPlusIdentifierTokens(withDecoratorToken(typescriptLanguage))
  )

  it('colors variables blue-token and functions yellow-token', () => {
    const [declaration, binding, call] = tokenizeLines(tokenizer, [
      'const count = 1',
      'const handler = () => count',
      'handler(count)'
    ])

    expect(typeOf(declaration!, 'count')).toBe('variable')
    expect(typeOf(binding!, 'handler')).toBe('function')
    expect(typeOf(binding!, 'count')).toBe('variable')
    expect(typeOf(call!, 'handler')).toBe('function')
    expect(typeOf(call!, 'count')).toBe('variable')
  })

  it('keeps keywords and decorators on their own tokens', () => {
    const [fn, decorated] = tokenizeLines(tokenizer, [
      'function greet(name: string) { return name }',
      '@Component class Widget {}'
    ])

    expect(typeOf(fn!, 'function')).toBe('keyword')
    expect(typeOf(fn!, 'greet')).toBe('function')
    expect(typeOf(fn!, 'name')).toBe('variable')
    expect(typeOf(fn!, 'string')).toBe('keyword')
    expect(typeOf(decorated!, '@Component')).toBe('keyword')
    expect(typeOf(decorated!, 'Widget')).toBe('type.identifier')
  })
})
