import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TestRunEnvFiles } from '../../shared/test-runs/test-run-settings'

const ENV_FILE_PATTERN = /^\.env(?:\..+)?$/

/** Gives a source a preset's secrets without overwriting env files the source already has. */
export function copyMissingEnvFiles(
  envFiles: TestRunEnvFiles,
  sourceDir: string
): { copied: string[] } | { error: string } {
  let names: string[]
  try {
    names = readdirSync(envFiles.from).filter(
      (name) => ENV_FILE_PATTERN.test(name) && !name.endsWith('.example')
    )
  } catch {
    return { error: `Cannot read the preset's env files in ${envFiles.from}.` }
  }
  const targetDir = join(sourceDir, envFiles.to)
  mkdirSync(targetDir, { recursive: true })
  const missing = names.filter((name) => !existsSync(join(targetDir, name)))
  for (const name of missing) {
    copyFileSync(join(envFiles.from, name), join(targetDir, name))
  }
  return { copied: missing }
}
