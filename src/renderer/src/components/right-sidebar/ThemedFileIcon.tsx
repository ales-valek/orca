import type { ReactNode } from 'react'
import { resolveFileIconThemeAsset } from '@/lib/file-icon-theme'
import { useSelectedFileIconTheme } from '@/store/plugin-icon-themes'
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
  const iconTheme = useSelectedFileIconTheme()
  const asset = iconTheme
    ? resolveFileIconThemeAsset(iconTheme, { name, isDirectory, isExpanded })
    : null
  if (!asset) {
    return <>{fallback}</>
  }
  return <PluginFileIcon asset={asset} className={className} />
}
