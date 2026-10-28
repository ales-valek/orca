import { translate } from '@/i18n/i18n'

// Why: the shared worktree-create runtime is also the CLI backend, so some of
// its errors carry CLI-flavored copy ("Pass an explicit --base..."). Map the
// known ones to actionable GUI copy; unknown errors pass through verbatim.
const DEFAULT_BASE_REF_ERROR = /could not resolve a default base ref/i

// Why: stack operations report bare codes, sometimes prefixed with the layer they refer to.
const STACK_ERROR_COPY: Record<string, (detail: string) => string> = {
  mission_task_not_top: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.cfd47e3be8',
      'Only the top task of a stack can be removed.'
    ),
  mission_task_parent_missing: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.3563c694af',
      'The top task has no workspace. Remove it before adding another task.'
    ),
  mission_absorb_layers_busy: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.9409032ab5',
      'A task layer has uncommitted changes or a working agent. Absorb needs every affected layer clean and idle.'
    ),
  mission_absorb_stack_stale: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.3ccbd3cb94',
      'The stack is out of date. Restack it, then absorb again.'
    ),
  mission_layer_not_clean: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.72c7c43c95',
      'A task layer has uncommitted changes. Commit or discard them, then retry.'
    ),
  mission_member_workspace_delete_required: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.8f57524962',
      'A workspace inside the mission folder cannot be kept. Remove it together with its workspace.'
    ),
  mission_stack_prs_unsupported_provider: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.9b92a95d43',
      'Stacked pull requests are supported only for GitHub repositories.'
    ),
  mission_stack_not_current: (detail) =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.5d1c0e7a43',
      'These task layers are not up to date: {{value0}}. Restack, then create the pull requests again.',
      { value0: detail }
    ),
  mission_orchestrator_repo_is_member: () =>
    translate(
      'auto.components.sidebar.MissionMemberErrorCopy.96dae2fc71',
      'The orchestrator project cannot also be a mission project.'
    )
}

export function formatMissionMemberError(error: string): string {
  if (DEFAULT_BASE_REF_ERROR.test(error)) {
    return translate(
      'auto.components.sidebar.MissionMemberErrorCopy.c8affe1f4b',
      'This repository has no commits or default branch yet. Make an initial commit (or set a default branch in Project Settings), then retry.'
    )
  }
  const code = Object.keys(STACK_ERROR_COPY).find((candidate) => error.includes(candidate))
  if (!code) {
    return error
  }
  const detail = error.slice(error.indexOf(code) + code.length).replace(/^:\s*/, '')
  return STACK_ERROR_COPY[code](detail)
}
