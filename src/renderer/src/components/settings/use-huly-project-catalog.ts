import { useCallback, useEffect, useRef, useState } from 'react'
import { formatHulyError, isHulyAuthRequiredError } from '@/components/huly-error-copy'
import type {
  HulyComponent,
  HulyProjectSummary,
  HulyStatus
} from '../../../../shared/huly/huly-types'

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

export type HulyProjectCatalog = { statuses: HulyStatus[]; components: HulyComponent[] }

/** Loads one Huly read, reporting an expired token to the caller instead of as an error. */
export function useHulyRead<T>(
  read: (() => Promise<T>) | null,
  onAuthRequired: () => void
): { result: Loadable<T>; retry: () => void } {
  const [result, setResult] = useState<Loadable<T>>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // A ref so an inline callback from the caller does not refetch on every render.
  const onAuthRequiredRef = useRef(onAuthRequired)
  onAuthRequiredRef.current = onAuthRequired

  useEffect(() => {
    if (!read) {
      return
    }
    let cancelled = false
    setResult({ state: 'loading' })
    read().then(
      (value) => {
        if (!cancelled) {
          setResult({ state: 'ready', value })
        }
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        if (isHulyAuthRequiredError(error)) {
          onAuthRequiredRef.current()
        }
        setResult({ state: 'error', message: formatHulyError(error) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [read, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { result, retry }
}

/** The first project that has saved Mission settings, otherwise the first project. */
export function getDefaultHulyProject(
  projects: readonly HulyProjectSummary[],
  configured: Record<string, unknown>
): string | null {
  const configuredProject = projects.find((project) => project.identifier in configured)
  return (configuredProject ?? projects[0])?.identifier ?? null
}

export function useHulyProjects(onAuthRequired: () => void) {
  const read = useCallback(() => window.api.huly.listProjects(), [])
  return useHulyRead<HulyProjectSummary[]>(read, onAuthRequired)
}

export function useHulyProjectCatalog(project: string | null, onAuthRequired: () => void) {
  const read = useCallback(async (): Promise<HulyProjectCatalog> => {
    if (!project) {
      return { statuses: [], components: [] }
    }
    const [statuses, components] = await Promise.all([
      window.api.huly.listStatuses({ project }),
      window.api.huly.listComponents({ project })
    ])
    return { statuses, components }
  }, [project])
  return useHulyRead(project ? read : null, onAuthRequired)
}
