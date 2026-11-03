/** Isolated configuration and credentials for offline real-engine checks. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

export function engineSandbox() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-asc-offline-'))
  const env = scrubbedParentEnv()
  for (const name of Object.keys(env)) {
    if (/^(ASC_|DSH_)/i.test(name)) delete env[name]
  }
  Object.assign(env, {
    HOME: directory,
    USERPROFILE: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    ASC_CONFIG_PATH: join(directory, 'missing-asc-config.json'),
    ASC_BYPASS_KEYCHAIN: '1',
    ASC_TELEMETRY_DISABLED: '1',
    ASC_SKILLS_AUTO_CHECK: 'false',
    ASC_READ_ONLY: '1',
  })
  // Explicit empty values also prevent exec.childEnv from forwarding real keys.
  for (const name of Object.keys(process.env)) {
    if (/^ASC_/i.test(name) && !(name in env)) env[name] = ''
  }
  for (const name of ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY_PATH', 'ASC_PRIVATE_KEY', 'ASC_WEB_SESSION']) {
    env[name] = ''
  }
  return { directory, env, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}
