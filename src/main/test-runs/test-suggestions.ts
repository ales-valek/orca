import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../shared/commit-message-host-key'
import { runGenerationRequest } from '../text-generation/agent-generation-request'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'
import { resolveTextGenerationParams } from '../text-generation/commit-message-text-generation'
import { spawnSourceControlAgent } from '../text-generation/source-control-agent-launch'
import { fitPromptToLocalCommandLine } from '../text-generation/source-control-text-generation-requests'

export type SuggestionTest = { index: number; title: string; file: string; tags: string[] }

export type TestSuggestion = { index: number; reason: string }

const MAX_SUGGESTIONS = 15

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
    ...input.changedFiles.map((file) => `- ${file}`),
    '',
    'Diff summary:',
    input.diffStat.trim(),
    '',
    'Tests:',
    tests
  ].join('\n')
}

/** The first JSON array in the answer; unknown, duplicate or malformed items are dropped. */
export function parseTestSuggestions(raw: string, count: number): TestSuggestion[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
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
}): Promise<{ suggestions: TestSuggestion[] } | { error: string }> {
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
    emptyResultName: 'suggestions',
    operation: 'test-suggestions'
  })
  if (!result.success) {
    return { error: result.error }
  }
  return { suggestions: parseTestSuggestions(result.rawOutput, input.tests.length) }
}
