import type {
  DevEnvDetail,
  DevEnvEnvFileView,
  DevEnvInfraState,
  DevEnvSummary
} from '../shared/dev-env/dev-env-types'

function formatRange(range: { first: number; last: number }): string {
  return `${range.first}–${range.last}`
}

export function formatDevEnvList(result: { envs: DevEnvSummary[] }): string {
  if (result.envs.length === 0) {
    return 'No Dev Environments.'
  }
  return result.envs
    .map((env) =>
      [
        env.badge.state.padEnd(10),
        env.key.padEnd(24),
        formatRange(env.portRange),
        env.attachmentLabel
      ].join('  ')
    )
    .join('\n')
}

export function formatDevEnvShow(detail: DevEnvDetail): string {
  const lines = [
    `${detail.name}  (${detail.templateName})`,
    `${detail.attachmentLabel} · key ${detail.key} · ports ${formatRange(detail.portRange)}`
  ]
  if (detail.hostnameError) {
    lines.push(`hostnames: ${detail.hostnameError}`)
  }
  lines.push('', 'services:')
  for (const service of detail.services) {
    const exit =
      service.status === 'crashed' && service.exitCode !== undefined
        ? ` (exit ${String(service.exitCode)})`
        : ''
    lines.push(
      `  ${service.status.padEnd(9)} ${service.name.padEnd(14)} ${String(service.port).padEnd(6)} ${service.url ?? ''}${exit}`
    )
  }
  const failed = Object.entries(detail.setup).find(([, step]) => step?.status === 'failed')
  if (failed) {
    lines.push('', `setup failed at ${failed[0]}: ${failed[1]?.error ?? ''}`)
  }
  for (const [dependency, state] of Object.entries(detail.dependencyStates)) {
    lines.push(`dependency ${dependency}: ${state}`)
  }
  return lines.join('\n')
}

export function formatDevEnvFiles(result: { files: DevEnvEnvFileView[] }): string {
  return result.files
    .map((file) =>
      [
        `# ${file.slot}/${file.path}${file.error ? `  (error: ${file.error})` : ''}`,
        ...file.values.map(
          (value) =>
            `${value.key}=${value.value}  [${value.sources.join(', ') || value.section.toLowerCase()}]`
        )
      ].join('\n')
    )
    .join('\n\n')
}

export function formatDevEnvInfra(result: {
  services: DevEnvInfraState[]
  error?: string
}): string {
  if (result.error) {
    return result.error
  }
  return result.services
    .map(
      (service) =>
        `${service.status.padEnd(9)} ${service.name.padEnd(14)} ${service.ports.join(', ')}`
    )
    .join('\n')
}

export function formatDevEnvRun(result: { started: string[]; errors: string[] }): string {
  const lines = [
    result.started.length > 0 ? `started ${result.started.join(', ')}` : 'nothing to start'
  ]
  return [...lines, ...result.errors.map((error) => `warning: ${error}`)].join('\n')
}
