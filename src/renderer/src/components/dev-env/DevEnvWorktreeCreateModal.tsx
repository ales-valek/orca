import React from 'react'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { DevEnvCreateDialog } from './DevEnvCreateDialog'

/** `dev-env-create-worktree` modal: the worktree id travels in modalData. */
export default function DevEnvWorktreeCreateModal(): React.JSX.Element | null {
  const worktree = useAppStore((s) => {
    const id = s.modalData.worktreeId
    return typeof id === 'string' ? findWorktreeById(s.worktreesByRepo, id) : undefined
  })
  const closeModal = useAppStore((s) => s.closeModal)
  if (!worktree) {
    return null
  }
  return (
    <DevEnvCreateDialog
      open
      onOpenChange={(open) => !open && closeModal()}
      target={{
        kind: 'worktree',
        worktreeId: worktree.id,
        name: worktree.displayName,
        repoId: worktree.repoId
      }}
    />
  )
}
