import { memo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import { FolderSourceControlPanel } from '../folder/folder-source-control-panel'
import { SourceControlPanelReady } from './panel-ready'
import { useSourceControlPanelModel } from './use-panel-model'

export const SourceControlPanel = memo(function SourceControlPanel() {
  const t = useTranslate()
  useUiLanguageRevision()
  const model = useSourceControlPanelModel()
  const { activeRepo, activeWorktree, isFolder, worktreePath } = model

  if (!activeWorktree || !activeRepo || !worktreePath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
        {t(
          'auto.components.right.sidebar.SourceControl.c07b236287',
          'Select a workspace to view changes'
        )}
      </div>
    )
  }
  if (isFolder) {
    return (
      <FolderSourceControlPanel
        folderPath={worktreePath}
        folderWorktreeId={activeWorktree.id}
        connectionId={model.activeConnectionId}
        executionHostId={activeWorktree.hostId ?? 'local'}
        runtimeEnvironmentId={model.activeRepoRuntimeEnvironmentId}
        runtimeSettings={model.activeRepoSettings}
      />
    )
  }

  return (
    <SourceControlPanelReady
      activeRepo={activeRepo}
      activeWorktree={activeWorktree}
      currentWorktreeId={activeWorktree.id}
      model={model}
      worktreePath={worktreePath}
    />
  )
})
