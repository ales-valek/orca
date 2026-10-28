/** Huly failures thrown as a bare code in the error message. */
export const HULY_MESSAGE_ERROR_CODES = [
  'huly_auth_required',
  'huly_not_connected',
  'huly_plan_empty',
  'huly_server_url_must_be_https'
] as const

/** Huly failures thrown as `error.code`, with detail in the message and sometimes `data`. */
export const HULY_STRUCTURED_ERROR_CODES = [
  'huly_plan_unresolved',
  'huly_project_required',
  'huly_milestone_not_found',
  'huly_milestone_ambiguous'
] as const

export type HulyErrorCode =
  | (typeof HULY_MESSAGE_ERROR_CODES)[number]
  | (typeof HULY_STRUCTURED_ERROR_CODES)[number]

export class HulyCodedError extends Error {
  constructor(
    readonly code: (typeof HULY_STRUCTURED_ERROR_CODES)[number],
    message: string
  ) {
    super(message)
  }
}
