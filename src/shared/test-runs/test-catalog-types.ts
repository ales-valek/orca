/** One test of a source, as Playwright lists it; identity matches run results. */
export type TestCatalogEntry = {
  identity: string
  configFile: string
  project: string
  /** Relative to the repo root. */
  file: string
  line: number
  titlePath: string[]
  /** With a leading @. */
  tags: string[]
  annotations: { type: string; description?: string }[]
  isSerial: boolean
}

export type TestCatalog = {
  sourceCommit: string | null
  configFile: string
  entries: TestCatalogEntry[]
  /** Output of a failed `playwright test --list`, e.g. a config that needs env. */
  error: string | null
  builtAt: number
}
