import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import {
  HULY_MESSAGE_ERROR_CODES,
  HULY_STRUCTURED_ERROR_CODES,
  type HulyErrorCode
} from '../../../shared/huly/huly-error-codes'

const HULY_ERROR_CODES: readonly HulyErrorCode[] = [
  ...HULY_MESSAGE_ERROR_CODES,
  ...HULY_STRUCTURED_ERROR_CODES
]

const HULY_ERROR_COPY: Record<HulyErrorCode, () => string> = {
  huly_auth_required: () =>
    translate(
      'auto.components.HulyErrorCopy.authRequired',
      'Huly rejected the saved token. Reconnect with a new token.'
    ),
  huly_not_connected: () =>
    translate('auto.components.HulyErrorCopy.notConnected', 'Huly is not connected.'),
  huly_plan_empty: () =>
    translate(
      'auto.components.HulyErrorCopy.planEmpty',
      'This milestone has no open issues to turn into tasks.'
    ),
  huly_plan_unresolved: () =>
    translate(
      'auto.components.HulyErrorCopy.planUnresolved',
      'Some issues have no repository or block each other in a cycle. Resolve them before creating the Mission.'
    ),
  huly_server_url_must_be_https: () =>
    translate(
      'auto.components.HulyErrorCopy.serverUrlMustBeHttps',
      'Use an https:// server URL. Plain http is allowed only for localhost.'
    ),
  huly_project_required: () =>
    translate('auto.components.HulyErrorCopy.projectRequired', 'Choose a Huly project.'),
  huly_milestone_not_found: () =>
    translate(
      'auto.components.HulyErrorCopy.milestoneNotFound',
      'Huly has no milestone with that name in this project.'
    ),
  huly_milestone_ambiguous: () =>
    translate(
      'auto.components.HulyErrorCopy.milestoneAmbiguous',
      'Several milestones share that name. Pick one from the list.'
    )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// IPC rejections wrap the runtime message, so the code is found anywhere in it.
function getHulyErrorCode(error: unknown): HulyErrorCode | null {
  const message = getErrorMessage(error)
  return HULY_ERROR_CODES.find((code) => message.includes(code)) ?? null
}

export function isHulyAuthRequiredError(error: unknown): boolean {
  return getHulyErrorCode(error) === 'huly_auth_required'
}

/** Readable copy for a failed Huly call; unknown failures pass through as their message. */
export function formatHulyError(error: unknown): string {
  const code = getHulyErrorCode(error)
  if (code) {
    return HULY_ERROR_COPY[code]()
  }
  return extractIpcErrorMessage(
    error,
    translate('auto.components.HulyErrorCopy.requestFailed', 'The Huly request failed.')
  )
}

/** Connect failures: the token being checked is new, and unexpected errors never echo it. */
export function formatHulyConnectError(error: unknown, token: string): string {
  const code = getHulyErrorCode(error)
  if (code === 'huly_auth_required') {
    return translate(
      'auto.components.HulyErrorCopy.connectAuthRejected',
      'Huly rejected this token.'
    )
  }
  if (code) {
    return HULY_ERROR_COPY[code]()
  }
  const detail = extractIpcErrorMessage(error, '')
  if (!detail) {
    return translate('auto.components.HulyErrorCopy.requestFailed', 'The Huly request failed.')
  }
  return translate(
    'auto.components.HulyErrorCopy.connectFailed',
    'Could not connect to Huly: {{detail}}',
    { detail: token ? detail.split(token).join('<redacted>') : detail }
  )
}
