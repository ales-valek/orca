import type {
  PluginIconThemeAsset,
  PluginIconThemeRegistration
} from '../../../shared/plugins/plugin-icon-theme-artifact'

type FileIconThemeTarget = {
  name: string
  isDirectory: boolean
  isExpanded: boolean
}

function extensionCandidates(name: string): string[] {
  const parts = name.toLowerCase().split('.')
  if (parts.length < 2 || parts[0] === '' || parts.at(-1) === '') {
    return []
  }
  return parts.slice(1).map((_, index) => parts.slice(index + 1).join('.'))
}

export function resolveFileIconThemeAsset(
  registration: PluginIconThemeRegistration,
  target: FileIconThemeTarget
): PluginIconThemeAsset | null {
  const name = target.name.toLowerCase()
  const { theme, assets } = registration
  let path: string | undefined

  if (target.isDirectory) {
    path = target.isExpanded
      ? (theme.folderNamesExpanded[name] ??
        theme.folderNames[name] ??
        theme.icons['folder-open'] ??
        theme.icons.folder)
      : (theme.folderNames[name] ?? theme.icons.folder)
  } else {
    path = theme.fileNames[name]
    for (const extension of extensionCandidates(name)) {
      path ??= theme.fileExtensions[extension]
    }
    path ??= theme.icons.file
  }

  return path ? (assets[path] ?? null) : null
}
