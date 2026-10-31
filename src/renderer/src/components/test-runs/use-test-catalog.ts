import { useEffect, useState } from 'react'
import type { FeatureScope, TestCatalog } from '../../../../shared/test-runs/test-catalog-types'

/** Playwright's list of the chosen source, built with the chosen target's env. */
export function useTestCatalog(input: {
  targetId: string | null
  sourceId: string | null
  configFile: string | null
}): { catalog: TestCatalog | null; isLoading: boolean; refresh: () => void } {
  const [catalog, setCatalog] = useState<TestCatalog | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const { targetId, sourceId, configFile } = input
  useEffect(() => {
    if (!targetId || !sourceId || !configFile) {
      setCatalog(null)
      return
    }
    let isCurrent = true
    setIsLoading(true)
    void window.api.testRuns
      .getCatalog({ targetId, sourceId, configFile })
      .then((next) => isCurrent && setCatalog(next))
      .catch(
        (error: unknown) =>
          isCurrent &&
          setCatalog({
            sourceCommit: null,
            configFile,
            entries: [],
            error: error instanceof Error ? error.message : String(error),
            builtAt: Date.now()
          })
      )
      .finally(() => isCurrent && setIsLoading(false))
    return () => {
      isCurrent = false
    }
  }, [targetId, sourceId, configFile, refreshCount])
  return { catalog, isLoading, refresh: () => setRefreshCount((count) => count + 1) }
}

/** What the source's branch changed since it left the default branch. */
export function useFeatureScope(sourceId: string | null): FeatureScope | null {
  const [scope, setScope] = useState<FeatureScope | null>(null)
  useEffect(() => {
    if (!sourceId) {
      setScope(null)
      return
    }
    let isCurrent = true
    void window.api.testRuns
      .getFeatureScope({ sourceId })
      .then((next) => isCurrent && setScope(next))
      .catch(() => isCurrent && setScope(null))
    return () => {
      isCurrent = false
    }
  }, [sourceId])
  return scope
}
