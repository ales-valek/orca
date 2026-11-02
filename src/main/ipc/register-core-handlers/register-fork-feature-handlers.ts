import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { registerCustomCssHandlers } from '../custom-css'
import { registerHulyHandlers } from '../huly/register-handlers'

/** Huly and the personal stylesheet: fork features kept out of the upstream registration list. */
export function registerForkFeatureHandlers(runtime: OrcaRuntimeService): void {
  registerHulyHandlers(runtime)
  registerCustomCssHandlers()
}
