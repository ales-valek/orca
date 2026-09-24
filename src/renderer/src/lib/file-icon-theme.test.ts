import { describe, expect, it } from 'vitest'
import type { PluginIconThemeRegistration } from '../../../shared/plugins/plugin-icon-theme-artifact'
import { resolveFileIconThemeAsset } from './file-icon-theme'

const asset = (name: string) => ({
  src: `data:image/svg+xml;base64,${name}` as const,
  monochrome: false
})

const registration: PluginIconThemeRegistration = {
  id: 'plugin:sample.icons/colorful',
  pluginKey: 'sample.icons',
  themeId: 'colorful',
  label: 'Colorful',
  theme: {
    schemaVersion: 1,
    icons: {
      file: 'file.svg',
      folder: 'folder.svg',
      'folder-open': 'folder-open.svg'
    },
    fileNames: { readme: 'readme.svg' },
    fileExtensions: { ts: 'typescript.svg', 'd.ts': 'declaration.svg' },
    folderNames: { src: 'source.svg' },
    folderNamesExpanded: { docs: 'docs-open.svg' }
  },
  assets: {
    'file.svg': asset('file'),
    'folder.svg': asset('folder'),
    'folder-open.svg': asset('folder-open'),
    'readme.svg': asset('readme'),
    'typescript.svg': asset('typescript'),
    'declaration.svg': asset('declaration'),
    'source.svg': asset('source'),
    'docs-open.svg': asset('docs-open')
  }
}

describe('resolveFileIconThemeAsset', () => {
  it('uses case-insensitive folder mappings and preserves their color when expanded', () => {
    expect(
      resolveFileIconThemeAsset(registration, {
        name: 'SRC',
        isDirectory: true,
        isExpanded: true
      })
    ).toBe(registration.assets['source.svg'])
  })

  it('prefers expanded folder mappings and then the expanded generic icon', () => {
    expect(
      resolveFileIconThemeAsset(registration, {
        name: 'docs',
        isDirectory: true,
        isExpanded: true
      })
    ).toBe(registration.assets['docs-open.svg'])
    expect(
      resolveFileIconThemeAsset(registration, {
        name: 'unknown',
        isDirectory: true,
        isExpanded: true
      })
    ).toBe(registration.assets['folder-open.svg'])
  })

  it('prefers exact names and longest compound extensions', () => {
    expect(
      resolveFileIconThemeAsset(registration, {
        name: 'README',
        isDirectory: false,
        isExpanded: false
      })
    ).toBe(registration.assets['readme.svg'])
    expect(
      resolveFileIconThemeAsset(registration, {
        name: 'types.d.ts',
        isDirectory: false,
        isExpanded: false
      })
    ).toBe(registration.assets['declaration.svg'])
  })
})
