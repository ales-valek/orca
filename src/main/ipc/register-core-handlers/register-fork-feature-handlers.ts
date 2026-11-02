import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { registerHulyHandlers } from '../huly/register-handlers'

/** Fork features kept out of the upstream registration list. */
export function registerForkFeatureHandlers(runtime: OrcaRuntimeService): void {
  registerHulyHandlers(runtime)
}
