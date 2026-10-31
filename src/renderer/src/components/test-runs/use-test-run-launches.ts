import { translate } from '@/i18n/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type {
  TestRunLaunch,
  TestRunSelection,
  TestRunSourceOption,
  TestRunTargetOption
} from '../../../../shared/test-runs/test-run-launch-types'
import {
  getKnownBugAnnotations,
  getTierPattern
} from '../../../../shared/test-runs/repo-test-run-settings'
import { findDevEnvForWorktree } from '../dev-env/DevEnvStatusBadge'
import { getDefaultSource, getDefaultTarget } from './test-run-selection'

type LaunchChoices = { targetId: string | null; sourceId: string | null; headed: boolean }

// Why module state: choices survive switching workspaces and remounting the panel.
const choicesByWorktree = new Map<string, LaunchChoices>()

export type TestRunLaunchControls = {
  targets: TestRunTargetOption[] | null
  sources: TestRunSourceOption[] | null
  choices: LaunchChoices
  setChoices: (changes: Partial<LaunchChoices>) => void
  launch: (selection: TestRunSelection, configFile?: string) => void
}

/** Target, source and headed choice of a workspace, and a launch with them. */
export function useTestRunLaunchControls(
  worktreeId: string | null,
  /** Repo root of the workspace's latest results; picks the default source. */
  resultsRoot: string | null
): TestRunLaunchControls {
  const devEnvId = useAppStore(
    (s) => (worktreeId ? findDevEnvForWorktree(s.devEnvs, worktreeId)?.id : null) ?? null
  )
  const [targets, setTargets] = useState<TestRunTargetOption[] | null>(null)
  const [sources, setSources] = useState<TestRunSourceOption[] | null>(null)
  const [stored, setStored] = useState<LaunchChoices | undefined>(() =>
    worktreeId ? choicesByWorktree.get(worktreeId) : undefined
  )

  useEffect(() => {
    void Promise.all([window.api.testRuns.listTargets(), window.api.testRuns.listSources()])
      .then(([nextTargets, nextSources]) => {
        setTargets(nextTargets)
        setSources(nextSources)
      })
      .catch(() => {
        setTargets([])
        setSources([])
      })
  }, [])

  useEffect(() => {
    setStored(worktreeId ? choicesByWorktree.get(worktreeId) : undefined)
  }, [worktreeId])

  const choices = useMemo((): LaunchChoices => {
    const repoId = sources?.find((source) => source.path === resultsRoot)?.repoId ?? null
    const targetId = stored?.targetId ?? getDefaultTarget(targets ?? [], devEnvId)
    const isPreset = targets?.find((option) => option.id === targetId)?.target.kind === 'preset'
    return {
      targetId,
      sourceId:
        stored?.sourceId ?? getDefaultSource(sources ?? [], repoId, { isPreset, worktreeId }),
      headed: stored?.headed ?? false
    }
  }, [stored, targets, sources, devEnvId, resultsRoot, worktreeId])

  const setChoices = useCallback(
    (changes: Partial<LaunchChoices>) => {
      const next = { ...choices, ...changes }
      if (worktreeId) {
        choicesByWorktree.set(worktreeId, next)
      }
      setStored(next)
    },
    [choices, worktreeId]
  )

  const launch = useCallback(
    (selection: TestRunSelection, configFile?: string) => {
      const target = targets?.find((option) => option.id === choices.targetId)
      const source = sources?.find((option) => option.id === choices.sourceId)
      if (!target || !source) {
        toast.error(
          translate('testRuns.launch.pickFirst', 'Pick a target and a test source first.')
        )
        return
      }
      void window.api.testRuns
        .launch({
          target: target.target,
          sourceId: source.id,
          configFile: configFile ?? source.configFiles[0] ?? 'playwright.config.ts',
          selection,
          headed: choices.headed,
          worktreeId
        })
        .then((result) => {
          if ('error' in result) {
            toast.error(translate('testRuns.launch.failed', 'Could not start the tests'), {
              description: result.error
            })
          }
        })
    },
    [targets, sources, choices, worktreeId]
  )

  return { targets, sources, choices, setChoices, launch }
}

/** Tier pattern and known-bug annotations of the chosen test source's repo. */
export function useSourceRepoSettings(controls: TestRunLaunchControls): {
  tierPattern: RegExp
  knownBugAnnotations: string[]
} {
  const repoId = controls.sources?.find((source) => source.id === controls.choices.sourceId)?.repoId
  const settings = useAppStore((s) => s.repos.find((repo) => repo.id === repoId)?.testRuns)
  return useMemo(
    () => ({
      tierPattern: getTierPattern(settings),
      knownBugAnnotations: getKnownBugAnnotations(settings)
    }),
    [settings]
  )
}

/** Launches of one workspace, newest first; refreshed when the launcher reports a change. */
export function useTestRunLaunches(worktreeId: string | null): TestRunLaunch[] {
  const [launches, setLaunches] = useState<TestRunLaunch[]>([])
  useEffect(() => {
    const load = (): void =>
      void window.api.testRuns
        .listLaunches()
        .then(setLaunches)
        .catch(() => setLaunches([]))
    load()
    return window.api.testRuns.onLaunchesChanged(load)
  }, [])
  return launches.filter((launch) => launch.worktreeId === worktreeId)
}

/** The tail of a launch's output, polled while the launch is active. */
export function useTestRunLaunchLog(id: string, isActive: boolean): string {
  const [log, setLog] = useState('')
  useEffect(() => {
    const load = (): void => void window.api.testRuns.readLaunchLog({ id }).then(setLog)
    load()
    if (!isActive) {
      return
    }
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [id, isActive])
  return log
}
