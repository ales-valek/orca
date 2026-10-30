import type { DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import type { DevContainerTool, DevContainerToolKind } from '../../shared/dev-env/dev-tools-types'
import { DEV_ENV_COMPOSE_PROJECT } from './dev-env-infra'

export const DEV_TOOLS_COMPOSE_PROJECT = 'orca-dev-tools'
/** Compose's default network of the infra project; tools reach services by name through it. */
export const DEV_ENV_INFRA_NETWORK = `${DEV_ENV_COMPOSE_PROJECT}_default`

const CONTAINER_PORT: Record<DevContainerToolKind, number> = {
  adminer: 8080,
  redisinsight: 5540,
  'bullmq-dashboard': 3000
}

const BULLMQ_DASHBOARD_PACKAGES = '@bull-board/express @bull-board/api express bullmq ioredis'

export function getInfraRedisPassword(service: DevEnvInfraService): string | null {
  const command = service.command ?? []
  const index = command.indexOf('--requirepass')
  return index === -1 ? null : (command[index + 1] ?? null)
}

export function getInfraPostgresUser(service: DevEnvInfraService): string {
  return service.environment.POSTGRES_USER || 'postgres'
}

/** The tools as compose services, so DevEnvInfra can report their state and start them. */
export function toDevToolComposeServices(tools: DevContainerTool[]): DevEnvInfraService[] {
  return tools.map((tool) => ({
    name: tool.name,
    ports: [{ name: 'http', host: tool.port, container: CONTAINER_PORT[tool.kind] }],
    environment: {},
    volumes: []
  }))
}

function getContainerPort(
  service: DevEnvInfraService | undefined,
  portName: string | undefined
): string {
  const port = service?.ports.find((entry) => entry.name === portName) ?? service?.ports[0]
  return String(port?.container ?? '')
}

function getToolService(
  tool: DevContainerTool,
  infraService: DevEnvInfraService | undefined,
  scriptDir: string
): Record<string, unknown> {
  const base = {
    restart: 'unless-stopped',
    ports: [`127.0.0.1:${tool.port}:${CONTAINER_PORT[tool.kind]}`],
    networks: ['infra']
  }
  const password = infraService ? (getInfraRedisPassword(infraService) ?? '') : ''
  switch (tool.kind) {
    case 'adminer':
      return {
        ...base,
        image: 'adminer',
        environment: { ADMINER_DEFAULT_SERVER: tool.infraService }
      }
    case 'redisinsight':
      return {
        ...base,
        image: 'redis/redisinsight',
        environment: {
          RI_REDIS_HOST: tool.infraService,
          RI_REDIS_PORT: getContainerPort(infraService, tool.infraPortName),
          RI_REDIS_PASSWORD: password,
          RI_REDIS_ALIAS: 'Orca infra'
        },
        volumes: ['orca-dev-tools-redisinsight:/data']
      }
    case 'bullmq-dashboard':
      return {
        ...base,
        image: 'node:22-alpine',
        working_dir: '/app',
        environment: {
          REDIS_HOST: tool.infraService,
          REDIS_PORT: getContainerPort(infraService, tool.infraPortName),
          REDIS_PASSWORD: password,
          PORT: String(CONTAINER_PORT['bullmq-dashboard'])
        },
        volumes: [`${scriptDir}:/app/src:ro`, 'orca-dev-tools-bullmq-modules:/app/node_modules'],
        // Why: packages install once into the named volume, then later starts reuse them.
        command: [
          'sh',
          '-c',
          `[ -d node_modules/@bull-board/express ] || npm install --no-audit --no-fund --prefix /app ${BULLMQ_DASHBOARD_PACKAGES}; exec node src/server.mjs`
        ]
      }
  }
}

export function buildDevToolsComposeJson(
  tools: DevContainerTool[],
  infra: DevEnvInfraService[],
  scriptDir: string
): string {
  const services = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      getToolService(
        tool,
        infra.find((service) => service.name === tool.infraService),
        scriptDir
      )
    ])
  )
  const doc = {
    name: DEV_TOOLS_COMPOSE_PROJECT,
    services,
    networks: { infra: { external: true, name: DEV_ENV_INFRA_NETWORK } },
    volumes: { 'orca-dev-tools-redisinsight': {}, 'orca-dev-tools-bullmq-modules': {} }
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}
