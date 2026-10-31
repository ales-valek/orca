export type TestResultLine = {
  status: string
  title: string
  location: string
  trigger: string
  startedAt: number
  error: string | null
}

const STATUS_MARK: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  timedOut: '✗',
  interrupted: '!',
  skipped: '-'
}

export function formatTestResults(result: { results: TestResultLine[] }): string {
  if (result.results.length === 0) {
    return 'No test results for this workspace yet.'
  }
  const lines = result.results.flatMap((entry) => [
    `${STATUS_MARK[entry.status] ?? '?'} ${entry.title}  ${entry.location}`,
    ...(entry.error ? [`    ${entry.error.split('\n')[0]}`] : [])
  ])
  const passed = result.results.filter((entry) => entry.status === 'passed').length
  const failed = result.results.filter(
    (entry) => entry.status === 'failed' || entry.status === 'timedOut'
  ).length
  return [...lines, '', `${passed} passed, ${failed} failed`].join('\n')
}

export function formatTestList(result: {
  tests: { title: string; location: string }[]
  error: string | null
}): string {
  if (result.error) {
    return `Could not list the tests:\n${result.error}`
  }
  return [
    ...result.tests.map((test) => `${test.title}  ${test.location}`),
    '',
    `${result.tests.length} tests`
  ].join('\n')
}

export function formatTestLaunch(launch: {
  id: string
  state: string
  title: string
  targetLabel: string
}): string {
  return `Started ${launch.title} against ${launch.targetLabel} (${launch.state}); launch ${launch.id}. Follow it in the Tests panel or with \`orca test results\`.`
}
