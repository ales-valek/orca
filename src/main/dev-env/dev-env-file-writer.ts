import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  buildDevEnvContext,
  type DevEnvDependencyValues
} from '../../shared/dev-env/dev-env-context'
import { renderDevEnvFile, type RenderedEnvValue } from '../../shared/dev-env/dev-env-file-render'
import type { DevEnvGlobalSettings } from '../../shared/dev-env/dev-env-settings'
import type { DevEnv, DevEnvTemplate } from '../../shared/dev-env/dev-env-types'

export type DevEnvRenderedFile = {
  slot: string
  path: string
  values: RenderedEnvValue[]
  /** Full file text including secrets; never send it to a renderer or CLI. */
  text?: string
  error?: string
}

/** `~/x` in a values file path means the user's home directory. */
function expandHomePath(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

/** Renders every env file of the bound slots in memory; writing is the caller's job. */
export async function renderDevEnvFiles(input: {
  env: DevEnv
  template: DevEnvTemplate
  slots?: string[]
  getSettings: () => DevEnvGlobalSettings
  secrets: { getAll(): Map<string, string> }
  resolveDependencies: (env: DevEnv) => Promise<ReadonlyMap<string, DevEnvDependencyValues>>
  readFile: (path: string) => Promise<string | null>
}): Promise<DevEnvRenderedFile[]> {
  const settings = input.getSettings()
  const context = buildDevEnvContext({
    env: input.env,
    template: input.template,
    infra: settings.devEnvInfra,
    proxyPort: settings.devEnvProxyPort,
    secrets: input.secrets.getAll(),
    dependencies: await input.resolveDependencies(input.env)
  })
  const files: DevEnvRenderedFile[] = []
  for (const slot of input.template.slots) {
    const worktree = input.env.slotWorktrees[slot.name]
    if (!worktree || (input.slots && !input.slots.includes(slot.name))) {
      continue
    }
    for (const file of slot.envFiles) {
      const valuesPath = file.valuesFile ? expandHomePath(file.valuesFile) : null
      const valuesText = valuesPath ? await input.readFile(valuesPath) : null
      if (valuesPath && valuesText === null) {
        files.push({
          slot: slot.name,
          path: file.path,
          values: [],
          error: `values file not found: ${valuesPath}`
        })
        continue
      }
      const result = renderDevEnvFile({
        valuesText,
        file,
        baseText: file.base ? await input.readFile(join(worktree.path, file.base)) : null,
        currentText: await input.readFile(join(worktree.path, file.path)),
        context,
        envLabel: input.env.key
      })
      files.push(
        'error' in result
          ? { slot: slot.name, path: file.path, values: [], error: result.error }
          : { slot: slot.name, path: file.path, values: result.values, text: result.text }
      )
    }
  }
  return files
}
