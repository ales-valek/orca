import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../shared/commit-message-host-key'
import { runGenerationRequest } from '../text-generation/agent-generation-request'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'
import { resolveTextGenerationParams } from '../text-generation/commit-message-text-generation'
import { spawnSourceControlAgent } from '../text-generation/source-control-agent-launch'
import { fitPromptToLocalCommandLine } from '../text-generation/source-control-text-generation-requests'

export type SuggestionTest = { index: number; title: string; file: string; tags: string[] }

export type TestSuggestion = { index: number; reason: string }

const MAX_SUGGESTIONS = 15
const MAX_CHANGED_FILES = 200
const MAX_PARSE_ATTEMPTS = 20

/** Asks for the tests a change could break, as JSON the parser below reads. */
export function buildTestSuggestionPrompt(
  input: { changedFiles: string[]; diffStat: string; tests: SuggestionTest[] },
  testsBudget?: number
): string {
  let tests = input.tests
    .map(
      (test) =>
        `${test.index}: ${test.title} (${test.file})${test.tags.length ? ` ${test.tags.join(' ')}` : ''}`
    )
    .join('\n')
  if (testsBudget !== undefined && tests.length > testsBudget) {
    tests = tests.slice(0, testsBudget)
  }
  return [
    'You pick end-to-end tests worth running for a code change.',
    `Return only a JSON array with at most ${MAX_SUGGESTIONS} items: [{"index": <test number>, "reason": "<one short sentence>"}].`,
    'Pick only tests the change could break. No prose outside the JSON array.',
    '',
    'Changed files:',
    ...input.changedFiles.slice(0, MAX_CHANGED_FILES).map((file) => `- ${file}`),
    ...(input.changedFiles.length > MAX_CHANGED_FILES
      ? [`… and ${input.changedFiles.length - MAX_CHANGED_FILES} more`]
      : []),
    '',
    'Diff summary:',
    input.diffStat.trim(),
    '',
    'Tests:',
    tests
  ].join('\n')
}

function getIndexes(text: string, char: string): number[] {
  const indexes: number[] = []
  for (let index = text.indexOf(char); index !== -1; index = text.indexOf(char, index + 1)) {
    indexes.push(index)
  }
  return indexes
}

/** The JSON array an agent returned, also when prose or a fenced block surrounds it. */
function findJsonArray(raw: string): unknown[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1]
  const text = fenced ?? raw
  const starts = getIndexes(text, '[').slice(0, MAX_PARSE_ATTEMPTS)
  const ends = getIndexes(text, ']').toReversed().slice(0, MAX_PARSE_ATTEMPTS)
  for (const start of starts) {
    for (const end of ends) {
      if (end <= start) {
        continue
      }
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1))
        if (Array.isArray(parsed)) {
          return parsed
        }
      } catch {
        // Not this pair of brackets; try the next.
      }
    }
  }
  return null
}

/** Known tests from the agent's answer; unknown, duplicate or malformed items are dropped. */
export function parseTestSuggestions(raw: string, count: number): TestSuggestion[] {
  const parsed = findJsonArray(raw)
  if (!parsed) {
    return []
  }
  const seen = new Set<number>()
  const suggestions: TestSuggestion[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || !('index' in item)) {
      continue
    }
    const index = item.index
    const reason = 'reason' in item && typeof item.reason === 'string' ? item.reason : ''
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) {
      continue
    }
    if (!seen.has(index)) {
      seen.add(index)
      suggestions.push({ index, reason })
    }
  }
  return suggestions.slice(0, MAX_SUGGESTIONS)
}

/** Runs the agent the user set up for source-control text (branch names) on the prompt. */
export async function generateTestSuggestions(input: {
  settings: Parameters<typeof resolveTextGenerationParams>[0]
  cwd: string
  changedFiles: string[]
  diffStat: string
  tests: SuggestionTest[]
}): Promise<{ suggestions: TestSuggestion[]; isListShortened: boolean } | { error: string }> {
  const resolved = resolveTextGenerationParams(
    input.settings,
    LOCAL_COMMIT_MESSAGE_HOST_KEY,
    'branchName',
    null
  )
  if (!resolved.ok) {
    return { error: resolved.error }
  }
  const localEnv = await prepareLocalCommitMessageAgentEnv(resolved.params.agentId, undefined)
  if (!localEnv.ok) {
    return { error: localEnv.error }
  }
  const target = {
    kind: 'local' as const,
    cwd: input.cwd,
    ...(localEnv.env ? { env: localEnv.env } : {})
  }
  const prompt = fitPromptToLocalCommandLine(resolved.params, target, (budget) =>
    buildTestSuggestionPrompt(input, budget)
  )
  const result = await runGenerationRequest({
    params: resolved.params,
    prompt,
    target,
    spawnAgent: spawnSourceControlAgent,
    operation: 'test-suggestions'
  })
  if (!result.success) {
    return { error: result.error }
  }
  return {
    suggestions: parseTestSuggestions(result.rawOutput, input.tests.length),
    // Why: on Windows the command line only fits part of a large test list.
    isListShortened: prompt.length < buildTestSuggestionPrompt(input).length
  }
}
