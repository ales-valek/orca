import type { GlobalSettings } from '../../../shared/global-settings-types'
import { normalizeHulyProjectsUpdate } from '../../../shared/huly/huly-project-settings'
import { normalizeDevEnvSettingsUpdate } from '../../../shared/dev-env/dev-env-settings'

/** Sanitized updates for settings slices owned by their feature modules. */
export function normalizeFeatureModuleSettingsUpdates(
  updates: Partial<GlobalSettings>
): Partial<GlobalSettings> {
  return { ...normalizeHulyProjectsUpdate(updates), ...normalizeDevEnvSettingsUpdate(updates) }
}
