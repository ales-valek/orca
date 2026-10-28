import { HulyCodedError } from '../../shared/huly/huly-error-codes'
import type { HulyGlobalSettings } from '../../shared/huly/huly-project-settings'
import type { HulyApi } from './huly-api'

/** The project as given, else the only configured project, else the only project in the workspace. */
export async function resolveHulyProject(
  api: Pick<HulyApi, 'listProjects'>,
  settings: Partial<HulyGlobalSettings>,
  project: string | undefined
): Promise<string> {
  if (project?.trim()) {
    return project.trim()
  }
  const configured = Object.keys(settings.hulyProjects ?? {})
  if (configured.length === 1) {
    return configured[0]
  }
  const projects = await api.listProjects()
  if (projects.length === 1) {
    return projects[0].identifier
  }
  const available = projects.map((entry) => entry.identifier).join(', ')
  throw new HulyCodedError(
    'huly_project_required',
    `huly_project_required: pass --project (one of ${available || 'none'})`
  )
}

/** Accepts a milestone id or its exact label, compared case-insensitively. */
export async function resolveHulyMilestoneId(
  api: Pick<HulyApi, 'listMilestones'>,
  project: string,
  selector: string
): Promise<string> {
  const milestones = await api.listMilestones(project)
  const wanted = selector.trim()
  const byId = milestones.find((milestone) => milestone.id === wanted)
  if (byId) {
    return byId.id
  }
  const label = wanted.toLocaleLowerCase()
  const byLabel = milestones.filter((milestone) => milestone.label.toLocaleLowerCase() === label)
  if (byLabel.length > 1) {
    throw new HulyCodedError(
      'huly_milestone_ambiguous',
      `huly_milestone_ambiguous: ${byLabel.map((m) => m.id).join(', ')}`
    )
  }
  if (byLabel.length === 0) {
    throw new HulyCodedError(
      'huly_milestone_not_found',
      `huly_milestone_not_found: ${wanted} in ${project}`
    )
  }
  return byLabel[0].id
}
