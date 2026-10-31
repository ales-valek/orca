import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTestIdentity } from '../../shared/test-runs/test-identity'
import { TestCatalogs, findSerialFiles, parsePlaywrightList } from './test-catalog'

const REPO = '/w/tests'

// Shaped like Playwright 1.61 `test --list --reporter=json` output.
const LIST = {
  config: { rootDir: '/w/tests/tests', configFile: '/w/tests/playwright.config.ts' },
  suites: [
    {
      title: 'eshop/tier-1/cart.spec.ts',
      file: 'eshop/tier-1/cart.spec.ts',
      specs: [
        {
          title: 'loose test',
          file: 'eshop/tier-1/cart.spec.ts',
          line: 30,
          tags: [],
          tests: [{ projectName: 'chromium', annotations: [] }]
        }
      ],
      suites: [
        {
          title: 'ESH-CART',
          file: 'eshop/tier-1/cart.spec.ts',
          specs: [
            {
              title: 'ESH-CART-01 adds',
              file: 'eshop/tier-1/cart.spec.ts',
              line: 4,
              tags: ['serial', '@fast'],
              tests: [
                {
                  projectName: 'chromium',
                  annotations: [{ type: 'bug-pin', description: 'CART-1', location: { line: 4 } }]
                },
                { projectName: 'admin', annotations: [] }
              ]
            }
          ]
        }
      ]
    }
  ]
}

let dir: string

describe('test catalog', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-test-catalog-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses specs per project with repo-relative files and title paths', () => {
    const entries = parsePlaywrightList(LIST, {
      repoRoot: REPO,
      repoKey: 'github.com/o/tests',
      configFile: 'playwright.config.ts'
    })
    expect(
      entries.map((entry) => [entry.project, entry.file, entry.line, entry.titlePath])
    ).toEqual([
      ['chromium', 'tests/eshop/tier-1/cart.spec.ts', 30, ['loose test']],
      ['chromium', 'tests/eshop/tier-1/cart.spec.ts', 4, ['ESH-CART', 'ESH-CART-01 adds']],
      ['admin', 'tests/eshop/tier-1/cart.spec.ts', 4, ['ESH-CART', 'ESH-CART-01 adds']]
    ])
  })

  it('resolves files when the repo path goes through a symlink', () => {
    const real = join(dir, 'real')
    mkdirSync(join(real, 'tests'), { recursive: true })
    symlinkSync(real, join(dir, 'link'))
    const list = { ...LIST, config: { ...LIST.config, rootDir: join(realpathSync(real), 'tests') } }
    const [entry] = parsePlaywrightList(list, {
      repoRoot: join(dir, 'link'),
      repoKey: 'k',
      configFile: 'playwright.config.ts'
    })
    expect(entry.file).toBe('tests/eshop/tier-1/cart.spec.ts')
  })

  it('prefixes tags and keeps annotations', () => {
    const entry = parsePlaywrightList(LIST, {
      repoRoot: REPO,
      repoKey: 'k',
      configFile: 'playwright.config.ts'
    })[1]
    expect(entry.tags).toEqual(['@serial', '@fast'])
    expect(entry.annotations).toEqual([{ type: 'bug-pin', description: 'CART-1' }])
  })

  it('builds the same identity as run results', () => {
    const entry = parsePlaywrightList(LIST, {
      repoRoot: REPO,
      repoKey: 'github.com/o/tests',
      configFile: 'playwright.config.ts'
    })[1]
    expect(entry.identity).toBe(
      getTestIdentity({
        originUrl: 'git@github.com:o/tests.git',
        repoRootName: 'tests',
        configFile: 'playwright.config.ts',
        project: 'chromium',
        file: 'tests/eshop/tier-1/cart.spec.ts',
        titlePath: ['ESH-CART', 'ESH-CART-01 adds']
      })
    )
  })

  it('finds serial files', () => {
    mkdirSync(join(dir, 'tests'))
    writeFileSync(join(dir, 'tests', 'a.spec.ts'), "test.describe.configure({ mode: 'serial' })")
    writeFileSync(join(dir, 'tests', 'b.spec.ts'), 'test.describe.serial("x", () => {})')
    writeFileSync(join(dir, 'tests', 'c.spec.ts'), "test.describe.configure({ mode: 'parallel' })")
    expect(
      [
        ...findSerialFiles(dir, [
          'tests/a.spec.ts',
          'tests/b.spec.ts',
          'tests/c.spec.ts',
          'tests/gone.spec.ts'
        ])
      ].sort()
    ).toEqual(['tests/a.spec.ts', 'tests/b.spec.ts'])
  })

  function createCatalogs(result: { code: number; stdout: string; stderr?: string }) {
    let spawns = 0
    const catalogs = new TestCatalogs({
      now: () => 1,
      spawn: () => {
        spawns++
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: () => true })
        setTimeout(() => {
          stdout.end(result.stdout)
          stderr.end(result.stderr ?? '')
          child.emit('exit', result.code)
        }, 0)
        return child
      }
    })
    return { catalogs, spawns: () => spawns }
  }

  const input = {
    cwd: REPO,
    cli: '/w/tests/node_modules/playwright/cli.js',
    env: {},
    configFile: 'playwright.config.ts',
    repoRoot: REPO,
    repoKey: 'k',
    commit: 'abc',
    isDirty: false,
    cacheKey: 'source|target'
  }

  it('reports a list failure with its output', async () => {
    const { catalogs } = createCatalogs({
      code: 1,
      stdout: '',
      stderr: 'Error: Missing ESHOP_BASE_URL'
    })
    await expect(catalogs.get(input)).resolves.toMatchObject({
      entries: [],
      error: expect.stringContaining('Missing ESHOP_BASE_URL')
    })
  })

  it('keeps the error message when a long stack trace follows it', async () => {
    const stack = Array.from({ length: 200 }, (_, i) => `    at frame${i} (/repo/file.ts:${i}:1)`)
    const { catalogs } = createCatalogs({
      code: 1,
      stdout: '',
      stderr: ['Error: Missing required environment variable ADMIN_USER_EMAIL.', ...stack].join(
        '\n'
      )
    })
    const catalog = await catalogs.get(input)
    expect(catalog.error).toMatch(/^Error: Missing required environment variable ADMIN_USER_EMAIL/)
  })

  it('reads the list after other output the config prints', async () => {
    const { catalogs } = createCatalogs({
      code: 0,
      stdout: `◇ injected env (16) from tests/.env.dev\n${JSON.stringify(LIST, null, 2)}\n`
    })
    await expect(catalogs.get(input)).resolves.toMatchObject({
      error: null,
      entries: expect.any(Array)
    })
    expect((await catalogs.get(input)).entries).toHaveLength(3)
  })

  it('lists again while the source has uncommitted changes', async () => {
    const { catalogs, spawns } = createCatalogs({ code: 0, stdout: JSON.stringify(LIST) })
    await catalogs.get({ ...input, isDirty: true })
    await catalogs.get({ ...input, isDirty: true })
    expect(spawns()).toBe(2)
  })

  it('runs one list for callers that ask at the same time', async () => {
    const { catalogs, spawns } = createCatalogs({ code: 0, stdout: JSON.stringify(LIST) })
    await Promise.all([
      catalogs.get({ ...input, isDirty: true }),
      catalogs.get({ ...input, isDirty: true })
    ])
    expect(spawns()).toBe(1)
  })

  it('keeps the tests Playwright listed even when it exits with an error', async () => {
    const { catalogs } = createCatalogs({
      code: 1,
      stdout: JSON.stringify(LIST),
      stderr: 'Error: tests/broken.spec.ts: Unexpected token'
    })
    const catalog = await catalogs.get(input)
    expect(catalog.entries).toHaveLength(3)
    expect(catalog.error).toContain('Unexpected token')
  })

  it('reuses the catalog for the same commit', async () => {
    const { catalogs, spawns } = createCatalogs({ code: 0, stdout: JSON.stringify(LIST) })
    const first = await catalogs.get(input)
    expect(first.entries).toHaveLength(3)
    await catalogs.get(input)
    expect(spawns()).toBe(1)
    await catalogs.get({ ...input, commit: 'def' })
    expect(spawns()).toBe(2)
  })
})
