import {
  HulyConnectParams,
  HulyMilestonePlanParams,
  HulyProjectParams
} from '../../../../shared/rpc-contract/huly-params'
import { defineMethod } from '../core'

export const HULY_METHODS = [
  defineMethod({
    name: 'huly.connect',
    permission: 'accounts-admin',
    params: HulyConnectParams,
    handler: async (params, { runtime }) =>
      runtime.hulyConnect({
        serverUrl: params.serverUrl.trim(),
        workspace: params.workspace.trim(),
        token: params.token.trim()
      })
  }),
  defineMethod({
    name: 'huly.disconnect',
    permission: 'accounts-admin',
    params: null,
    handler: async (_params, { runtime }) => runtime.hulyDisconnect()
  }),
  defineMethod({
    name: 'huly.status',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.hulyStatus()
  }),
  defineMethod({
    name: 'huly.listProjects',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.hulyListProjects()
  }),
  defineMethod({
    name: 'huly.listMilestones',
    permission: 'workspace',
    params: HulyProjectParams,
    handler: async (params, { runtime }) => runtime.hulyListMilestones(params.project.trim())
  }),
  defineMethod({
    name: 'huly.getMilestonePlan',
    permission: 'workspace',
    params: HulyMilestonePlanParams,
    handler: async (params, { runtime }) =>
      runtime.hulyGetMilestonePlan({
        project: params.project.trim(),
        milestoneId: params.milestoneId.trim(),
        ...(params.repoOverrides ? { repoOverrides: params.repoOverrides } : {}),
        ...(params.orderOverrides ? { orderOverrides: params.orderOverrides } : {})
      })
  }),
  defineMethod({
    name: 'huly.listStatuses',
    permission: 'workspace',
    params: HulyProjectParams,
    handler: async (params, { runtime }) => runtime.hulyListStatuses(params.project.trim())
  }),
  defineMethod({
    name: 'huly.listComponents',
    permission: 'workspace',
    params: HulyProjectParams,
    handler: async (params, { runtime }) => runtime.hulyListComponents(params.project.trim())
  })
]
