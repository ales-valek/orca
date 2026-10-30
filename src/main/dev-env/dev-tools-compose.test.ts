import { describe, expect, it } from 'vitest'
import type { DevEnvInfraService } from '../../shared/dev-env/dev-env-types'
import type { DevContainerTool } from '../../shared/dev-env/dev-tools-types'
import {
  buildDevToolsComposeJson,
  getInfraPostgresUser,
  getInfraRedisPassword,
  toDevToolComposeServices
} from './dev-tools-compose'

const POSTGRES: DevEnvInfraService = {
  name: 'postgres',
  ports: [{ name: 'db', host: 19032, container: 5432 }],
  environment: { POSTGRES_USER: 'postgres' },
  volumes: []
}
const REDIS: DevEnvInfraService = {
  name: 'redis',
  ports: [{ name: 'redis', host: 19079, container: 6379 }],
  environment: {},
  command: ['redis-server', '--requirepass', 'pw'],
  volumes: []
}
const ADMINER: DevContainerTool = {
  kind: 'adminer',
  name: 'db',
  label: 'Databáze',
  port: 19180,
  infraService: 'postgres'
}
const INSIGHT: DevContainerTool = {
  kind: 'redisinsight',
  name: 'redis',
  label: 'Redis',
  port: 19181,
  infraService: 'redis'
}
const QUEUES: DevContainerTool = {
  kind: 'bullmq-dashboard',
  name: 'queues',
  label: 'Fronty',
  port: 19182,
  infraService: 'redis'
}
const MINIO: DevEnvInfraService = {
  name: 'minio',
  ports: [
    { name: 'api', host: 19001, container: 9001 },
    { name: 'console', host: 19002, container: 9002 }
  ],
  environment: { MINIO_ROOT_USER: 'user', MINIO_ROOT_PASSWORD: 'secret' },
  volumes: []
}
const FILES: DevContainerTool = {
  kind: 's3-browser',
  name: 'files',
  label: 'Soubory',
  port: 19183,
  infraService: 'minio',
  infraPortName: 'api'
}

function compose(tools: DevContainerTool[]) {
  return JSON.parse(
    buildDevToolsComposeJson(tools, [POSTGRES, REDIS, MINIO], '/data/tools/bullmq-dashboard')
  )
}

describe('dev tools compose', () => {
  it('runs Adminer on loopback in the infra network, pointed at the postgres service', () => {
    const doc = compose([ADMINER])
    expect(doc.name).toBe('orca-dev-tools')
    expect(doc.services.db).toMatchObject({
      image: 'adminer',
      restart: 'unless-stopped',
      ports: ['127.0.0.1:19180:8080'],
      environment: { ADMINER_DEFAULT_SERVER: 'postgres' },
      networks: ['infra']
    })
    expect(doc.networks.infra).toEqual({ external: true, name: 'orca-infra_default' })
  })

  it('preconfigures RedisInsight with the infra redis container port and password', () => {
    expect(compose([INSIGHT]).services.redis.environment).toMatchObject({
      RI_REDIS_HOST: 'redis',
      RI_REDIS_PORT: '6379',
      RI_REDIS_PASSWORD: 'pw'
    })
  })

  it('runs the BullMQ dashboard script from the mounted directory', () => {
    const service = compose([QUEUES]).services.queues
    expect(service.image).toBe('node:22-alpine')
    expect(service.ports).toEqual(['127.0.0.1:19182:3000'])
    expect(service.volumes).toContain('/data/tools/bullmq-dashboard:/app/src:ro')
    expect(service.environment).toMatchObject({
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'pw'
    })
  })

  it('browses MinIO through its S3 API with the infra root credentials', () => {
    const service = compose([FILES]).services.files
    expect(service.ports).toEqual(['127.0.0.1:19183:8080'])
    expect(service.environment).toMatchObject({
      ENDPOINT: 'minio:9001',
      ACCESS_KEY_ID: 'user',
      SECRET_ACCESS_KEY: 'secret',
      USE_SSL: 'false'
    })
  })

  it('connects to the chosen infra port when the service has several', () => {
    const multi = {
      ...REDIS,
      ports: [{ name: 'metrics', host: 19099, container: 9121 }, ...REDIS.ports]
    }
    const doc = JSON.parse(
      buildDevToolsComposeJson([{ ...INSIGHT, infraPortName: 'redis' }], [POSTGRES, multi], '/s')
    )
    expect(doc.services.redis.environment.RI_REDIS_PORT).toBe('6379')
  })

  it('reads credentials from the infra definition with safe fallbacks', () => {
    expect(getInfraRedisPassword(REDIS)).toBe('pw')
    expect(getInfraRedisPassword({ ...REDIS, command: ['redis-server'] })).toBeNull()
    expect(getInfraPostgresUser({ ...POSTGRES, environment: {} })).toBe('postgres')
  })

  it('maps tools to compose services for status and start-up', () => {
    expect(toDevToolComposeServices([ADMINER])).toEqual([
      {
        name: 'db',
        ports: [{ name: 'http', host: 19180, container: 8080 }],
        environment: {},
        volumes: []
      }
    ])
  })
})
