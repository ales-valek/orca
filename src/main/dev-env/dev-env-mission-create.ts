import type { DevEnvOperations } from './dev-env-operations'

/** Creates the environment picked at mission create; an error is returned, never thrown, so the mission stays. */
export async function createMissionDevEnv(
  getOperations: () => DevEnvOperations,
  missionId: string,
  templateId: string | undefined
): Promise<string | null> {
  if (!templateId) {
    return null
  }
  try {
    await getOperations().createForMission(missionId, templateId)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
