import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function createLocalBuildVersion(baseVersion, timestamp, commit) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(baseVersion)) {
    throw new Error(`Package version is not valid semver: ${baseVersion}`)
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Local build timestamp is invalid.')
  }
  const sanitizedCommit = commit.replace(/[^0-9A-Za-z-]/g, '').slice(0, 12)
  if (!sanitizedCommit) {
    throw new Error('Git commit identity is empty.')
  }
  const suffix = `local.${timestamp}.${sanitizedCommit}`
  return baseVersion.includes('-') ? `${baseVersion}.${suffix}` : `${baseVersion}-${suffix}`
}

// Why: releases bump the version on tag-only commits, so main's package.json lags far behind them.
// ponytail: trusts the newest fetched tag, so tags fetched without a rebase overstate the version.
export function resolveLocalBuildBaseVersion(packageVersion, gitTags) {
  const [packageCore] = packageVersion.split('-')
  const newest = [packageCore, ...gitTags.map((tag) => tag.match(/^v(\d+\.\d+\.\d+)$/)?.[1])]
    .filter(Boolean)
    .map((version) => version.split('.').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    .pop()
  if (newest.join('.') === packageCore) {
    return packageVersion
  }
  // Main is past the newest release, and a -local prerelease of that release would sort below it.
  return `${newest[0]}.${newest[1]}.${newest[2] + 1}`
}

export function getLocalBuildIdentity() {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n')
  return {
    commit,
    version: createLocalBuildVersion(
      resolveLocalBuildBaseVersion(packageJson.version, tags),
      Date.now(),
      commit
    )
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const identity = getLocalBuildIdentity()
  console.log(`[build:mac] local update version ${identity.version}`)
  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'electron-builder', '--config', 'config/electron-builder.config.cjs', '--mac'],
    {
      env: {
        ...process.env,
        ORCA_BUILD_COMMIT: identity.commit,
        ORCA_LOCAL_BUILD_VERSION: identity.version
      },
      stdio: 'inherit'
    }
  )
}
