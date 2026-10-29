import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readStoredCredentialToken, writeEncryptedCredential } from '../integration-credential-file'

const SECRET_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
const SECRET_SUFFIX = '.secret'

/** One encrypted file per secret; values never leave main except into rendered env files. */
export class DevEnvSecretStore {
  constructor(private readonly dir: string) {}

  private pathFor(name: string): string {
    if (!SECRET_NAME.test(name)) {
      throw new Error('Invalid secret name')
    }
    return join(this.dir, `${name}${SECRET_SUFFIX}`)
  }

  list(): string[] {
    if (!existsSync(this.dir)) {
      return []
    }
    return readdirSync(this.dir)
      .filter((file) => file.endsWith(SECRET_SUFFIX))
      .map((file) => file.slice(0, -SECRET_SUFFIX.length))
      .filter((name) => SECRET_NAME.test(name))
      .sort()
  }

  get(name: string): string | null {
    try {
      return readStoredCredentialToken('DevEnv', readFileSync(this.pathFor(name)))
    } catch {
      return null
    }
  }

  set(name: string, value: string): void {
    const path = this.pathFor(name)
    mkdirSync(this.dir, { recursive: true })
    writeEncryptedCredential('DevEnv', path, value)
  }

  delete(name: string): boolean {
    const path = this.pathFor(name)
    if (!existsSync(path)) {
      return false
    }
    unlinkSync(path)
    return true
  }

  getAll(): Map<string, string> {
    const secrets = new Map<string, string>()
    for (const name of this.list()) {
      const value = this.get(name)
      if (value !== null) {
        secrets.set(name, value)
      }
    }
    return secrets
  }
}
