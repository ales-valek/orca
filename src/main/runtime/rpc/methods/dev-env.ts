import {
  DevEnvBindParams,
  DevEnvCreateParams,
  DevEnvDeleteParams,
  DevEnvFileParams,
  DevEnvInfraParams,
  DevEnvPinSlotParams,
  DevEnvRequiredServiceParams,
  DevEnvResetParams,
  DevEnvSelectorParams,
  DevEnvServiceParams,
  DevEnvSetupParams
} from '../../../../shared/rpc-contract/dev-env-params'
import { defineMethod, type RpcContext } from '../core'

function ops(context: RpcContext) {
  return context.runtime.getDevEnvOperations()
}

function envId(context: RpcContext, selector: string): string {
  return ops(context).resolveId(selector)
}

export const DEV_ENV_METHODS = [
  defineMethod({
    name: 'devenv.list',
    permission: 'workspace',
    params: null,
    handler: async (_params, context) => ({ envs: await ops(context).list() })
  }),
  defineMethod({
    name: 'devenv.show',
    permission: 'workspace',
    params: DevEnvSelectorParams,
    handler: async (params, context) => ops(context).show(envId(context, params.env))
  }),
  defineMethod({
    name: 'devenv.setup',
    permission: 'workspace',
    params: DevEnvSetupParams,
    handler: async (params, context) => {
      ops(context).startSetup(envId(context, params.env), {
        ...(params.step ? { steps: [params.step] } : {}),
        ...(params.slot ? { slots: [params.slot] } : {}),
        ...(params.seed ? { withSeed: true } : {})
      })
      return { started: true }
    }
  }),
  defineMethod({
    name: 'devenv.up',
    permission: 'workspace',
    params: DevEnvServiceParams,
    handler: async (params, context) =>
      ops(context).up(envId(context, params.env), params.service ? [params.service] : undefined)
  }),
  defineMethod({
    name: 'devenv.down',
    permission: 'workspace',
    params: DevEnvServiceParams,
    handler: async (params, context) => {
      await ops(context).down(
        envId(context, params.env),
        params.service ? [params.service] : undefined
      )
      return { stopped: true }
    }
  }),
  defineMethod({
    name: 'devenv.restart',
    permission: 'workspace',
    params: DevEnvRequiredServiceParams,
    handler: async (params, context) =>
      ops(context).restart(envId(context, params.env), params.service)
  }),
  defineMethod({
    name: 'devenv.url',
    permission: 'workspace',
    params: DevEnvRequiredServiceParams,
    handler: async (params, context) => {
      const detail = await ops(context).show(envId(context, params.env))
      const service = detail.services.find((entry) => entry.name === params.service)
      if (!service) {
        throw new Error(`Unknown service ${params.service}`)
      }
      return { url: service.url, port: service.port, status: service.status }
    }
  }),
  defineMethod({
    name: 'devenv.env',
    permission: 'workspace',
    params: DevEnvFileParams,
    handler: async (params, context) => {
      const files = await ops(context).getEnvFiles(envId(context, params.env))
      return {
        files: params.file
          ? files.filter((file) => `${file.slot}/${file.path}` === params.file)
          : files
      }
    }
  }),
  defineMethod({
    name: 'devenv.seed',
    permission: 'workspace',
    params: DevEnvSelectorParams,
    handler: async (params, context) => {
      ops(context).startSetup(envId(context, params.env), { steps: ['seed'], withSeed: true })
      return { started: true }
    }
  }),
  defineMethod({
    name: 'devenv.reset',
    permission: 'workspace',
    params: DevEnvResetParams,
    handler: async (params, context) => {
      await ops(context).reset(envId(context, params.env), { reseed: params.reseed === true })
      return { started: true }
    }
  }),
  defineMethod({
    name: 'devenv.bind',
    permission: 'workspace',
    params: DevEnvBindParams,
    handler: async (params, context) =>
      ops(context).bind(
        envId(context, params.env),
        params.dependency,
        params.provider === null ? null : envId(context, params.provider)
      )
  }),
  defineMethod({
    name: 'devenv.pinSlot',
    permission: 'workspace',
    params: DevEnvPinSlotParams,
    handler: async (params, context) =>
      ops(context).pinSlot(envId(context, params.env), params.slot, params.worktree)
  }),
  defineMethod({
    name: 'devenv.create',
    permission: 'workspace',
    params: DevEnvCreateParams,
    handler: async (params, context) =>
      params.mission
        ? ops(context).createForMission(params.mission, params.template)
        : ops(context).createForWorktree(params.worktree ?? '', params.template, params.bindings)
  }),
  defineMethod({
    name: 'devenv.delete',
    permission: 'workspace',
    params: DevEnvDeleteParams,
    handler: async (params, context) => {
      await ops(context).delete(envId(context, params.env), { dropData: params.dropData })
      return { deleted: true }
    }
  }),
  defineMethod({
    name: 'devenv.infraStatus',
    permission: 'workspace',
    params: null,
    handler: async (_params, context) => {
      const status = await ops(context).infra.getStatus()
      return 'error' in status ? { services: [], error: status.error } : { services: status }
    }
  }),
  defineMethod({
    name: 'devenv.infraUp',
    permission: 'workspace',
    params: DevEnvInfraParams,
    handler: async (params, context) => {
      const operations = ops(context)
      const names = params.service ? [params.service] : operations.getInfraNames()
      return operations.infra.ensure(names, operations.getInfraLogPath())
    }
  }),
  defineMethod({
    name: 'devenv.infraDown',
    permission: 'workspace',
    params: DevEnvInfraParams,
    handler: async (params, context) => {
      const operations = ops(context)
      const ok = params.service
        ? await operations.infra.stop(params.service, operations.getInfraLogPath())
        : await operations.infra.down(operations.getInfraLogPath())
      return { ok }
    }
  })
]
