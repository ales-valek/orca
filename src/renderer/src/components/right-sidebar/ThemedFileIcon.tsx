import type { ReactNode } from 'react'
import { useAppStore } from '@/store'
import { resolveFileIconThemeAsset } from '@/lib/file-icon-theme'
import { usePluginIconThemes } from '@/store/plugin-icon-themes'
import { PluginFileIcon } from './PluginFileIcon'

type ThemedFileIconProps = {
  name: string
  isDirectory?: boolean
  isExpanded?: boolean
  className: string
  fallback: ReactNode
}

export function ThemedFileIcon({
  name,
  isDirectory = false,
  isExpanded = false,
  className,
  fallback
}: ThemedFileIconProps): React.JSX.Element {
  const selectedIconThemeId = useAppStore((state) => state.settings?.fileIconTheme ?? 'builtin')
  const iconTheme = usePluginIconThemes().find((theme) => theme.id === selectedIconThemeId) ?? null
  const asset = iconTheme
    ? resolveFileIconThemeAsset(iconTheme, { name, isDirectory, isExpanded })
    : null
  if (!asset) {
    return <>{fallback}</>
  }
  return <PluginFileIcon asset={asset} className={className} />
}
