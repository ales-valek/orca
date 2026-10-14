import { isTuiAgent } from '../../../../shared/tui-agent-config'
import {
  MissionAddReposParams,
  MissionCreateParams,
  MissionPathParams,
  MissionRemoveParams,
  MissionSelectorParams
} from '../../../../shared/rpc-contract/mission-params'
import { defineMethod } from '../core'

export const MISSION_METHODS = [
  defineMethod({
    name: 'mission.list',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => runtime.listMissions()
  }),
  defineMethod({
    name: 'mission.show',
    permission: 'workspace',
    params: MissionSelectorParams,
    handler: (params, { runtime }) => runtime.showMission(params.mission)
  }),
  defineMethod({
    name: 'mission.forPath',
    permission: 'workspace',
    params: MissionPathParams,
    handler: (params, { runtime }) => runtime.showMissionForPath(params.path)
  }),
  defineMethod({
    name: 'mission.create',
    permission: 'workspace',
    params: MissionCreateParams,
    handler: async (params, { runtime }) =>
      runtime.createMissionFromSelectors({
        name: params.name,
        repos: params.repos,
        ...(params.branch ? { branch: params.branch.trim() } : {}),
        ...(isTuiAgent(params.agent) ? { agent: params.agent } : {})
      })
  }),
  defineMethod({
    name: 'mission.session',
    permission: 'workspace',
    params: MissionSelectorParams,
    handler: async (params, { runtime }) => runtime.ensureMissionSession(params.mission)
  }),
  defineMethod({
    name: 'mission.addRepos',
    permission: 'workspace',
    params: MissionAddReposParams,
    handler: async (params, { runtime }) => runtime.addMissionRepos(params.mission, params.repos)
  }),
  defineMethod({
    name: 'mission.remove',
    permission: 'workspace',
    params: MissionRemoveParams,
    handler: async (params, { runtime }) =>
      runtime.removeMission(params.mission, params.deleteWorktrees)
  })
]
