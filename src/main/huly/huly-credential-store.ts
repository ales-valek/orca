import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { HulyConnectionInfo } from '../../shared/huly/huly-types'
import {
  credentialFileHasContent,
  readStoredCredentialToken,
  writeCredentialFileAtomic,
  writeEncryptedCredential
} from '../credentials/integration-credential-file'

export type HulyCredentialStore = {
  readInfo(): HulyConnectionInfo | null
  readToken(): string | null
  hasToken(): boolean
  save(info: HulyConnectionInfo, token: string): void
  clear(): void
}

const connectionInfoSchema = z.object({ serverUrl: z.string(), workspace: z.string() })

export function createHulyCredentialStore(
  directory: string = join(homedir(), '.orca')
): HulyCredentialStore {
  const infoPath = join(directory, 'huly-connection.json')
  const tokenPath = join(directory, 'huly-token.enc')

  return {
    readInfo() {
      const raw = readOptionalFile(infoPath)
      if (raw === null) {
        return null
      }
      try {
        const parsed = connectionInfoSchema.safeParse(JSON.parse(raw.toString('utf-8')))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
    readToken() {
      const raw = readOptionalFile(tokenPath)
      return raw === null ? null : readStoredCredentialToken('Huly', raw)
    },
    hasToken() {
      return credentialFileHasContent(tokenPath)
    },
    save(info, token) {
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true })
      }
      // Token first: a connection file without a token reads as disconnected.
      writeEncryptedCredential('Huly', tokenPath, token)
      const data = { serverUrl: info.serverUrl, workspace: info.workspace }
      writeCredentialFileAtomic(infoPath, Buffer.from(`${JSON.stringify(data, null, 2)}\n`))
    },
    clear() {
      removeOptionalFile(tokenPath)
      removeOptionalFile(infoPath)
    }
  }
}

function readOptionalFile(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

function removeOptionalFile(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Missing files already mean disconnected.
  }
}
