import type { TestRunSelection } from '../../shared/test-runs/test-run-launch-types'

export function buildPlaywrightArgs(input: {
  cli: string
  configFile: string
  selection: TestRunSelection
  headed: boolean
}): string[] {
  const filters =
    input.selection.kind === 'tests'
      ? input.selection.locations
      : input.selection.kind === 'paths'
        ? input.selection.paths
        : []
  return [
    input.cli,
    'test',
    '-c',
    input.configFile,
    ...filters,
    ...(input.headed ? ['--headed'] : [])
  ]
}

export function getLaunchTitle(selection: TestRunSelection, headed: boolean): string {
  const title =
    selection.kind === 'tests'
      ? `${selection.locations.length} ${selection.locations.length === 1 ? 'test' : 'tests'}`
      : selection.kind === 'paths'
        ? selection.paths.join(', ')
        : 'All tests'
  return headed ? `${title} · headed` : title
}
