import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { readMediaPreview } from '../../media/media-preview-protocol'
import type { Store } from '../../persistence'
import { TestRunStore } from '../../test-runs/test-run-store'
import { TestRunsChangeNotifier } from '../../test-runs/test-runs-change-notifier'
import { getTestRunsDir, installOrcaPlaywrightReporter } from '../../test-runs/test-runs-install'
import { TraceViewers } from '../../test-runs/trace-viewer'

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000

const FilterArgs = z.object({
  worktreeId: z.string().optional(),
  repoKey: z.string().optional(),
  limit: z.number().int().positive().optional()
})
const HistoryArgs = z.object({ identity: z.string().min(1) })
const ArtifactArgs = z.object({ runId: z.string().min(1), file: z.string().min(1) })

let notifier: TestRunsChangeNotifier | null = null

/** Desktop only in v1: runs are captured where Orca's terminals run. */
export function registerTestRunsHandlers(mainWindow: BrowserWindow, store: Store): void {
  const dir = getTestRunsDir(app.getPath('userData'))
  installOrcaPlaywrightReporter(dir)
  const runsDir = join(dir, 'runs')
  mkdirSync(runsDir, { recursive: true })
  const runs = new TestRunStore({ dir })
  const traceViewers = new TraceViewers()

  const prune = (): void => {
    try {
      runs.prune()
    } catch (error) {
      console.error('[test-runs] prune failed', error)
    }
  }
  setTimeout(prune, 60_000).unref()
  setInterval(prune, PRUNE_INTERVAL_MS).unref()
  notifier?.stop()
  notifier = new TestRunsChangeNotifier({
    runsDir,
    store: runs,
    notify: () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('testRuns:changed')
      }
    }
  })
  notifier.start()
  app.once('will-quit', () => {
    notifier?.stop()
    traceViewers.disposeAll()
  })

  const handlers: Record<string, (event: IpcMainInvokeEvent, args: unknown) => unknown> = {
    'testRuns:listRuns': (_event, raw) => runs.listRuns(FilterArgs.parse(raw ?? {})),
    'testRuns:getLatestResults': (_event, raw) => {
      const { worktreeId, repoKey } = FilterArgs.parse(raw ?? {})
      return runs.getLatestResults({ worktreeId, repoKey })
    },
    'testRuns:getHistory': (_event, raw) => runs.getHistory(HistoryArgs.parse(raw).identity),
    'testRuns:getArtifactUrl': (event, raw) => {
      const { runId, file } = ArtifactArgs.parse(raw)
      const imageUrl = runs.readImageDataUrl(runId, file)
      if (imageUrl) {
        return { url: imageUrl }
      }
      const filePath = runs.getArtifactPath(runId, file)
      // Why user-file: main validated the path inside the runs dir, which no project root covers.
      const media = filePath
        ? readMediaPreview(event, { filePath, access: { kind: 'user-file' } }, store)
        : null
      return media ? { url: media.mediaUrl } : { error: 'This artifact cannot be shown' }
    },
    'testRuns:openTrace': async (_event, raw) => {
      const { runId, file } = ArtifactArgs.parse(raw)
      const tracePath = runs.getArtifactPath(runId, file)
      const run = runs.listRuns().find((entry) => entry.id === runId)
      if (!tracePath || !run) {
        return { error: 'This trace no longer exists' }
      }
      return traceViewers.open(tracePath, run.repo.root)
    }
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, args: unknown) => handler(event, args))
  }
}
