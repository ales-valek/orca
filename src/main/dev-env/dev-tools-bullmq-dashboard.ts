/** BullMQ keeps one `<prefix>:<queue>:meta` hash per queue; prefixes differ per environment. */
export const BULLMQ_META_KEY_PATTERN = /^(.+):([^:]+):meta$/

export function parseBullmqMetaKey(key: string): { prefix: string; queue: string } | null {
  const match = BULLMQ_META_KEY_PATTERN.exec(key)
  return match ? { prefix: match[1] ?? '', queue: match[2] ?? '' } : null
}

/**
 * server.mjs of the `bullmq-dashboard` tool container. One bull-board for every prefix in Redis:
 * a stock image watches a single prefix, while each environment has its own.
 */
export function getBullmqDashboardSource(): string {
  return `import express from 'express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

const META_KEY = new RegExp(${JSON.stringify(BULLMQ_META_KEY_PATTERN.source)})
const RESCAN_MS = 30_000
const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD || undefined
}
const redis = new IORedis({ ...connection, maxRetriesPerRequest: null })
const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/')
const board = createBullBoard({ queues: [], serverAdapter })
const adapters = new Map()

async function findQueueKeys() {
  const found = new Map()
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', '*:meta', 'COUNT', 1000)
    cursor = next
    for (const key of keys) {
      const match = META_KEY.exec(key)
      if (match) {
        found.set(key, { prefix: match[1], queue: match[2] })
      }
    }
  } while (cursor !== '0')
  return found
}

async function rescan() {
  const found = await findQueueKeys()
  for (const [key, { prefix, queue }] of found) {
    if (!adapters.has(key)) {
      const instance = new Queue(queue, { prefix, connection })
      // One unique name per prefix, grouped by environment in the board's queue tree.
      adapters.set(key, new BullMQAdapter(instance, { prefix: prefix + ':', delimiter: ':' }))
    }
  }
  for (const key of [...adapters.keys()]) {
    if (!found.has(key)) {
      adapters.delete(key)
    }
  }
  const sorted = [...adapters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, adapter]) => adapter)
  board.replaceQueues(sorted)
}

await rescan()
setInterval(() => rescan().catch((error) => console.error('[bullmq-dashboard] rescan failed', error.message)), RESCAN_MS)
const app = express()
app.use('/', serverAdapter.getRouter())
app.listen(Number(process.env.PORT || 3000), () => console.log('[bullmq-dashboard] ready'))
`
}
