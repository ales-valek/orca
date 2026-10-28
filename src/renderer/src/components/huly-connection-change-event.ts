export const HULY_CONNECTION_CHANGED_EVENT = 'orca:huly-connection-changed'

/** Lets mounted Huly status readers re-read after a connect or disconnect elsewhere in the app. */
export function notifyHulyConnectionChanged(): void {
  window.dispatchEvent(new CustomEvent(HULY_CONNECTION_CHANGED_EVENT))
}
