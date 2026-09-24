import { describe, expect, it } from 'vitest'
import { DEFAULT_TERMINAL_INACTIVE_PANE_OPACITY, getDefaultSettings } from './constants'
import {
  getDefaultPrimarySelectionMiddleClickPaste,
  getDefaultTerminalRightClickToPaste
} from './terminal-platform-defaults'

describe('getDefaultSettings', () => {
  it('uses platform-consistent separators for the default workspace directory', () => {
    expect(getDefaultSettings('/Users/alice').workspaceDir).toBe('/Users/alice/orca/workspaces')
    expect(getDefaultSettings('C:\\Users\\alice').workspaceDir).toBe(
      'C:\\Users\\alice\\orca\\workspaces'
    )
  })

  it('enables gitignored file decorations by default', () => {
    expect(getDefaultSettings('/tmp').showGitIgnoredFiles).toBe(true)
  })

  it('uses Orca built-in file icons by default', () => {
    expect(getDefaultSettings('/tmp').fileIconTheme).toBe('builtin')
    expect(getDefaultSettings('/tmp').folderColorOverrides).toEqual({})
  })

  it('uses list view for Source Control changes by default', () => {
    expect(getDefaultSettings('/tmp').sourceControlViewMode).toBe('list')
  })

  it('keeps Source Control changes first by default', () => {
    expect(getDefaultSettings('/tmp').sourceControlGroupOrder).toBe('changes-first')
  })

  it('defaults mobile pairing to discovered network addresses', () => {
    expect(getDefaultSettings('/tmp').mobilePairingCustomAddress).toBeNull()
    expect(getDefaultSettings('/tmp').mobilePairingCustomAddresses).toEqual([])
  })

  it('keeps first-work branch auto-renaming on by default for new settings', () => {
    expect(getDefaultSettings('/tmp').autoRenameBranchFromWork).toBe(true)
    expect(getDefaultSettings('/tmp').autoRenameBranchFromWorkDefaultedOn).toBe(true)
  })

  it('uses a block terminal cursor by default for new settings', () => {
    expect(getDefaultSettings('/tmp').terminalCursorStyle).toBe('block')
    expect(getDefaultSettings('/tmp').terminalCursorStyleDefaultedToBlock).toBe(true)
  })

  it('allows OSC 52 clipboard writes by default for new settings', () => {
    expect(getDefaultSettings('/tmp').terminalAllowOsc52Clipboard).toBe(true)
    expect(getDefaultSettings('/tmp').terminalAllowOsc52ClipboardDefaultedOnForAllUsers).toBe(true)
  })

  it('enables separate light terminal theme by default', () => {
    expect(getDefaultSettings('/tmp').terminalUseSeparateLightTheme).toBe(true)
  })

  it('keeps inactive terminal panes readable by default', () => {
    expect(getDefaultSettings('/tmp').terminalInactivePaneOpacity).toBe(
      DEFAULT_TERMINAL_INACTIVE_PANE_OPACITY
    )
  })

  it('asks before closing terminals with running processes by default', () => {
    expect(getDefaultSettings('/tmp').skipCloseTerminalWithRunningProcessConfirm).toBe(false)
  })
})

describe('getDefaultPrimarySelectionMiddleClickPaste', () => {
  it('enables primary selection paste on Linux by default', () => {
    expect(getDefaultPrimarySelectionMiddleClickPaste('linux')).toBe(true)
  })

  it('enables primary selection paste on macOS by default', () => {
    expect(getDefaultPrimarySelectionMiddleClickPaste('darwin')).toBe(true)
  })

  it('leaves primary selection paste opt-in on Windows', () => {
    expect(getDefaultPrimarySelectionMiddleClickPaste('win32')).toBe(false)
  })
})

describe('getDefaultTerminalRightClickToPaste', () => {
  it('defaults on only for Windows', () => {
    expect(getDefaultTerminalRightClickToPaste('win32')).toBe(true)
    expect(getDefaultTerminalRightClickToPaste('darwin')).toBe(false)
    expect(getDefaultTerminalRightClickToPaste('linux')).toBe(false)
  })
})
