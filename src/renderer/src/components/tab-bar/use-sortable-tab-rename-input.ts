import type React from 'react'
import { useSortableTabRename } from './use-sortable-tab-rename'
import { useTabRenameReturnFocus } from './use-tab-rename-return-focus'

/** Rename state plus the input's handlers: IME-safe Enter/Escape that then hand focus back to the tab. */
export function useSortableTabRenameInput(
  rename: Parameters<typeof useSortableTabRename>[0],
  focus: Omit<Parameters<typeof useTabRenameReturnFocus>[0], 'commitRename' | 'cancelRename'>
) {
  const {
    onRenameKeyDown: onStripRenameKeyDown,
    onRenameKeyUp,
    onRenameCompositionStart,
    onRenameCompositionEnd,
    ...state
  } = useSortableTabRename(rename)
  const { renameOwnerRef, restoreContentFocus } = useTabRenameReturnFocus({
    ...focus,
    commitRename: state.commitRename,
    cancelRename: state.cancelRename
  })
  const inputKeyProps = {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>): void => {
      onStripRenameKeyDown(event)
      if (event.defaultPrevented) {
        restoreContentFocus()
      }
    },
    onKeyUp: onRenameKeyUp,
    onCompositionStart: onRenameCompositionStart,
    onCompositionEnd: onRenameCompositionEnd
  }
  return { ...state, renameOwnerRef, inputKeyProps }
}
