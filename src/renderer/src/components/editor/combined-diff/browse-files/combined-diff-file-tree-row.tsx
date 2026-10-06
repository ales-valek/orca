import { createElement, memo, type ReactNode } from 'react'
import { ChevronDown, Folder, FolderOpen } from 'lucide-react'
import { STATUS_COLORS, STATUS_LABELS } from '@/components/right-sidebar/status-display'
import type { SourceControlTreeNode } from '@/components/right-sidebar/source-control-tree'
import { resolveFileIconThemeAsset } from '@/lib/file-icon-theme'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { basename, dirname, joinPath } from '@/lib/path'
import { PluginFileIcon } from '@/components/right-sidebar/PluginFileIcon'
import type { PluginIconThemeRegistration } from '../../../../../../shared/plugins/plugin-icon-theme-artifact'
import { cn } from '@/lib/utils'
import { WORKSPACE_FILE_PATH_MIME } from '@/lib/workspace-file-drag'
import { writeWorkspaceFileDragSourceForWorkspace } from '@/lib/workspace-file-drag-source'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import type {
  GitFileStatus,
  GitStagingArea,
  GitStatusEntry
} from '../../../../../../shared/git-status-types'
import {
  getCombinedDiffFileTreeSectionKey,
  type CombinedDiffBranchTreeArea,
  type CombinedDiffFileTreeEntry,
  type CombinedDiffFileTreeMode
} from '../resolve-changes/combined-diff-section-identity'

export type CombinedDiffTreeNode = SourceControlTreeNode<
  GitStatusEntry | GitBranchChangeEntry,
  GitStagingArea | CombinedDiffBranchTreeArea
>

// Why: every row is a single `py-1 text-xs` line (16px line box + 8px padding); measureElement
// still corrects, but a wrong estimate makes the virtualized tree's scrollbar jump on first paint.
export const COMBINED_DIFF_TREE_ROW_HEIGHT_PX = 24
const COMBINED_DIFF_TREE_INDENT_PX = 12
const COMBINED_DIFF_TREE_DIRECTORY_PADDING_PX = 8
const COMBINED_DIFF_TREE_FILE_PADDING_PX = 20

function DiffTreeThemeIcon({
  iconTheme,
  name,
  isDirectory = false,
  isExpanded = false,
  className,
  fallback
}: {
  iconTheme: PluginIconThemeRegistration | null
  name: string
  isDirectory?: boolean
  isExpanded?: boolean
  className: string
  fallback: ReactNode
}): React.JSX.Element {
  const asset = iconTheme
    ? resolveFileIconThemeAsset(iconTheme, { name, isDirectory, isExpanded })
    : null
  if (!asset) {
    return <>{fallback}</>
  }
  return <PluginFileIcon asset={asset} className={className} />
}

export const CombinedDiffFileTreeRow = memo(function CombinedDiffFileTreeRow({
  node,
  mode,
  worktreePath,
  sourceWorkspaceId,
  iconTheme = null,
  activeSectionKey,
  sectionIndexByKey,
  isCollapsed,
  visibleFileCount,
  onToggleDirectory,
  onNavigate
}: {
  node: CombinedDiffTreeNode
  mode: CombinedDiffFileTreeMode
  worktreePath: string
  sourceWorkspaceId?: string
  iconTheme?: PluginIconThemeRegistration | null
  activeSectionKey: string | null
  sectionIndexByKey: ReadonlyMap<string, number>
  isCollapsed: boolean
  visibleFileCount?: number
  onToggleDirectory: (key: string) => void
  onNavigate: (entry: CombinedDiffFileTreeEntry) => void
}): React.JSX.Element {
  if (node.type === 'directory') {
    return (
      <div
        className="group relative flex w-full items-center gap-1 py-1 pr-3 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        style={{
          paddingLeft: `${node.depth * COMBINED_DIFF_TREE_INDENT_PX + COMBINED_DIFF_TREE_DIRECTORY_PADDING_PX}px`
        }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(WORKSPACE_FILE_PATH_MIME, joinPath(worktreePath, node.path))
          if (sourceWorkspaceId) {
            writeWorkspaceFileDragSourceForWorkspace(event.dataTransfer, sourceWorkspaceId)
          }
          event.dataTransfer.effectAllowed = 'copy'
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={() => onToggleDirectory(node.key)}
          aria-expanded={!isCollapsed}
        >
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', isCollapsed && '-rotate-90')}
          />
          <DiffTreeThemeIcon
            iconTheme={iconTheme}
            name={node.name}
            isDirectory
            isExpanded={!isCollapsed}
            className="size-3 shrink-0"
            fallback={
              isCollapsed ? (
                <Folder className="size-3 shrink-0" />
              ) : (
                <FolderOpen className="size-3 shrink-0" />
              )
            }
          />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-muted-foreground/80">
          {visibleFileCount ?? node.fileCount}
        </span>
      </div>
    )
  }

  const sectionKey = getCombinedDiffFileTreeSectionKey(mode, node.entry)
  const FileIcon = getFileTypeIcon(node.entry.path)
  const fileName = basename(node.entry.path)
  const parentDir = dirname(node.entry.path)
  const dirPath = parentDir === '.' ? '' : parentDir
  const status = node.entry.status as GitFileStatus
  const disabled = !sectionIndexByKey.has(sectionKey)

  return (
    <button
      type="button"
      className={cn(
        'group flex w-full min-w-0 cursor-pointer items-center gap-1 py-1 pr-3 text-left text-xs transition-colors hover:bg-accent/40 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
        activeSectionKey === sectionKey && 'bg-accent/60'
      )}
      style={{
        paddingLeft: `${node.depth * COMBINED_DIFF_TREE_INDENT_PX + COMBINED_DIFF_TREE_FILE_PADDING_PX}px`
      }}
      disabled={disabled}
      draggable={!disabled}
      onDragStart={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        event.dataTransfer.setData(
          WORKSPACE_FILE_PATH_MIME,
          joinPath(worktreePath, node.entry.path)
        )
        if (sourceWorkspaceId) {
          writeWorkspaceFileDragSourceForWorkspace(event.dataTransfer, sourceWorkspaceId)
        }
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onNavigate(node.entry)}
    >
      <DiffTreeThemeIcon
        iconTheme={iconTheme}
        name={fileName}
        className="size-3.5 shrink-0"
        fallback={createElement(FileIcon, {
          className: 'size-3.5 shrink-0',
          style: { color: STATUS_COLORS[status] }
        })}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{fileName}</span>
        {dirPath && <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>}
      </span>
      <span
        className="w-4 shrink-0 text-center text-[10px] font-bold"
        style={{ color: STATUS_COLORS[status] }}
      >
        {STATUS_LABELS[status]}
      </span>
    </button>
  )
})
