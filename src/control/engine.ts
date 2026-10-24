/**
 * The engine manager: locate, diagnose and (optionally) provision `asc`.
 *
 * `asc` is an external engine, not an npm dependency. The plugin therefore
 * owns the *experience* of installing and upgrading it:
 *
 * 1. resolve a binary (configured path → `ASC_CLI_PATH` → plugin cache → PATH),
 * 2. probe its version and compare it with the tested range,
 * 3. report one actionable next step,
 * 4. optionally download a pinned, checksum-verified build into the DSH cache.
 *
 * Provisioning is opt-in (`allowProvision`) and never runs implicitly.
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checksumsUrl,
  compatMessage,
  compatStatus,
  compareVersions,
  parseChecksums,
  PINNED_ASC_VERSION,
  releaseAsset,
  releaseUrl,
  type CompatStatus,
} from '../compat.js'
import type { Config } from '../config.js'
import { execAsc, type SpawnFn } from '../exec.js'

/** Where a resolved binary came from. */
export type AscSource = 'configured' | 'env' | 'cache' | 'path'

/** One resolved executable. */
export interface AscResolution {
  readonly path: string
  readonly source: AscSource
}

/** A tiny result wrapper for engine probes. */
export interface EngineFact<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: string
}

/** Parsed `asc auth status`. */
export interface AuthStatus {
  readonly stored: number
  readonly storage?: string
  readonly environmentProvided: boolean
  readonly authenticated: boolean
}

/** One app row used by onboarding. */
export interface AppSummary {
  readonly id: string
  readonly name?: string
  readonly bundleId?: string
}

/** One line of the doctor report. */
export interface DiagnoseCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

/** The single next action the user should take. */
export interface DiagnoseNext {
  readonly title: string
  readonly command?: string
  readonly detail?: string
}

/** Everything `/asc-doctor` and `asc_setup diagnose` report. */
export interface DiagnoseReport {
  readonly resolution: AscResolution
  readonly version?: string
  readonly compat: CompatStatus
  readonly checks: readonly DiagnoseCheck[]
  readonly authenticated: boolean
  readonly defaultAppId?: string
  readonly firstApp?: AppSummary
  readonly provision: { readonly available: boolean; readonly pinned: string; readonly cached: boolean }
  readonly next?: DiagnoseNext
}

/** Result of one provisioning attempt. */
export interface ProvisionResult {
  readonly ok: boolean
  readonly path?: string
  readonly version?: string
  readonly bytes?: number
  readonly error?: string
}

/** Injectable pieces used by tests. */
export interface ProvisionDeps {
  readonly fetch?: typeof fetch
}

/** Asc engine surface used by commands, setup and tools. */
export interface AscEngine {
  resolve(): AscResolution
  cachedBinaryPath(version?: string): string
  version(): Promise<string | undefined>
  authStatus(validate: boolean): Promise<EngineFact<AuthStatus>>
  listApps(limit: number): Promise<EngineFact<readonly AppSummary[]>>
  diagnose(options?: { validateAuth?: boolean }): Promise<DiagnoseReport>
  provision(deps?: ProvisionDeps): Promise<ProvisionResult>
}

/** `$DSH_HOME/cache/asc-cli` (or `cacheDir`). */
export function cacheRoot(config: Config): string {
  if (config.cacheDir !== undefined) return config.cacheDir
  const home = process.env.DSH_HOME?.trim()
  return join(home === undefined || home.length === 0 ? join(homedir(), '.dsh') : home, 'cache', 'asc-cli')
}

function executableName(): string {
  return process.platform === 'win32' ? 'asc.exe' : 'asc'
}

function firstSemver(text: string): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1]
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Build the engine around the plugin config and one spawn seam. */
export function createEngine(config: Config, spawn: SpawnFn): AscEngine {
  let versionProbe: Promise<string | undefined> | undefined

  function cachedBinaryPath(version: string = PINNED_ASC_VERSION): string {
    return join(cacheRoot(config), version, `${process.platform}-${process.arch}`, executableName())
  }

  function resolve(): AscResolution {
    if (config.ascPath !== 'asc') return { path: config.ascPath, source: 'configured' }
    const fromEnv = process.env.ASC_CLI_PATH?.trim()
    if (fromEnv !== undefined && fromEnv.length > 0) return { path: fromEnv, source: 'env' }
    const cached = cachedBinaryPath()
    if (existsSync(cached)) return { path: cached, source: 'cache' }
    return { path: config.ascPath, source: 'path' }
  }

  async function run(
    argv: readonly string[],
    options: { timeoutMs?: number; output?: boolean } = {},
  ): Promise<{ ok: boolean; data?: unknown; stdout: string; stderr: string; missing: boolean }> {
    const resolution = resolve()
    const outcome = await execAsc(
      { ...config, ascPath: resolution.path },
      {
        argv,
        cwd: config.workdir ?? process.cwd(),
        timeoutMs: options.timeoutMs ?? config.timeoutMs,
        maxBytes: config.maxOutputBytes,
        appendOutput: options.output !== false,
      },
      spawn,
    )
    return {
      ok: outcome.ok,
      data: outcome.data,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      missing: outcome.exitCode === -1 && /enoent|not found|no such file/i.test(outcome.stderr),
    }
  }

  async function version(): Promise<string | undefined> {
    versionProbe ??= run(['version'], { timeoutMs: 15_000, output: false }).then((result) =>
      result.ok ? firstSemver(result.stdout) : undefined,
    )
    return versionProbe
  }

  async function authStatus(validate: boolean): Promise<EngineFact<AuthStatus>> {
    const result = await run(['auth', 'status', ...(validate ? ['--validate'] : [])], { timeoutMs: 20_000 })
    if (result.missing) return { ok: false, error: 'asc binary not found' }
    const data = recordOf(result.data)
    const credentials = Array.isArray(data.credentials) ? data.credentials : []
    const environmentProvided = data.environmentCredentialsProvided === true
    const status: AuthStatus = {
      stored: credentials.length,
      ...(typeof data.storageBackend === 'string' ? { storage: data.storageBackend } : {}),
      environmentProvided,
      authenticated: credentials.length > 0 || environmentProvided,
    }
    if (!result.ok) {
      return { ok: false, value: status, error: result.stderr.trim() || `auth status exited with an error` }
    }
    return { ok: true, value: status }
  }

  async function listApps(limit: number): Promise<EngineFact<readonly AppSummary[]>> {
    const result = await run(['apps', 'list', '--limit', String(limit)], { timeoutMs: 20_000 })
    if (!result.ok) return { ok: false, error: result.stderr.trim() || 'apps list failed' }
    const data = recordOf(result.data)
    const rows = Array.isArray(data.data) ? data.data : []
    const apps = rows.slice(0, limit).map((row) => {
      const item = recordOf(row)
      const attributes = recordOf(item.attributes)
      return {
        id: typeof item.id === 'string' ? item.id : '?',
        ...(typeof attributes.name === 'string' ? { name: attributes.name } : {}),
        ...(typeof attributes.bundleId === 'string' ? { bundleId: attributes.bundleId } : {}),
      } satisfies AppSummary
    })
    return { ok: true, value: apps }
  }

  async function diagnose(options: { validateAuth?: boolean } = {}): Promise<DiagnoseReport> {
    const resolution = resolve()
    const checks: DiagnoseCheck[] = []
    const found = await version()
    checks.push({
      name: 'binary',
      ok: found !== undefined,
      detail:
        found === undefined
          ? `not found (looked for ${resolution.path}; source ${resolution.source})`
          : `${resolution.path} (source: ${resolution.source})`,
    })
    const compat = compatStatus(found)
    checks.push({ name: 'version', ok: compat === 'supported', detail: compatMessage(compat, found) })

    const auth = await authStatus(options.validateAuth !== false)
    const authenticated = auth.value?.authenticated === true
    checks.push({
      name: 'auth',
      ok: authenticated,
      detail:
        auth.error !== undefined
          ? auth.error
          : authenticated
            ? `${auth.value?.stored ?? 0} stored credential(s)${auth.value?.environmentProvided === true ? ' + environment' : ''}`
            : 'no credentials found',
    })

    checks.push({
      name: 'default-app',
      ok: config.defaultAppId !== undefined,
      detail: config.defaultAppId === undefined ? 'not configured (optional; every tool accepts `app`)' : config.defaultAppId,
    })

    let firstApp: AppSummary | undefined
    if (authenticated && config.defaultAppId === undefined) {
      const apps = await listApps(1)
      if (apps.ok && apps.value?.[0] !== undefined) firstApp = apps.value[0]
    }

    const provision = {
      available: config.allowProvision && releaseAsset(PINNED_ASC_VERSION) !== undefined,
      pinned: PINNED_ASC_VERSION,
      cached: existsSync(cachedBinaryPath()),
    }

    let next: DiagnoseNext | undefined
    if (found === undefined) {
      next = {
        title: 'Install asc',
        command: 'brew install asc',
        detail: config.allowProvision
          ? 'or ask the agent to run asc_setup with action provision'
          : 'or set ascPath / enable allowProvision and run asc_setup action provision',
      }
    } else if (!authenticated) {
      next = {
        title: 'Authenticate asc in your terminal',
        command: 'asc auth login --name "MyApp" --key-id <KEY_ID> --issuer-id <ISSUER_ID> --private-key <AuthKey.p8>',
        detail: 'never paste a private key into the chat; run it yourself, then ask for /asc-doctor again',
      }
    } else if (config.defaultAppId === undefined) {
      next = {
        title: 'Pick a default app (optional)',
        command: firstApp === undefined ? undefined : `set defaultAppId: "${firstApp.id}"`,
        detail:
          firstApp === undefined
            ? 'ask for `asc_apps list` to find an app id'
            : `first available: ${firstApp.name ?? firstApp.id} (${firstApp.id})`,
      }
    } else {
      next = { title: 'Ready', detail: 'Try /asc for the capability card, or ask for a release check' }
    }

    return {
      resolution,
      ...(found === undefined ? {} : { version: found }),
      compat,
      checks,
      authenticated,
      ...(config.defaultAppId === undefined ? {} : { defaultAppId: config.defaultAppId }),
      ...(firstApp === undefined ? {} : { firstApp }),
      provision,
      ...(next === undefined ? {} : { next }),
    }
  }

  async function provision(deps: ProvisionDeps = {}): Promise<ProvisionResult> {
    if (!config.allowProvision) {
      return {
        ok: false,
        error:
          'provisioning is disabled; set `allowProvision: true` in the asc-tools config, or install asc yourself (`brew install asc`)',
      }
    }
    const asset = releaseAsset(PINNED_ASC_VERSION)
    if (asset === undefined) {
      return { ok: false, error: `upstream publishes no ${process.platform}-${process.arch} build for asc ${PINNED_ASC_VERSION}` }
    }
    const fetchImpl = deps.fetch ?? fetch
    const destination = cachedBinaryPath()
    const temporary = `${destination}.download`
    try {
      const listing = await fetchImpl(checksumsUrl(PINNED_ASC_VERSION), { signal: AbortSignal.timeout(20_000) })
      if (!listing.ok) return { ok: false, error: `checksum list download failed (HTTP ${listing.status})` }
      const expected = parseChecksums(await listing.text()).get(asset)
      if (expected === undefined) return { ok: false, error: `checksum list does not contain ${asset}` }

      const download = await fetchImpl(releaseUrl(asset, PINNED_ASC_VERSION), { signal: AbortSignal.timeout(180_000) })
      if (!download.ok) return { ok: false, error: `binary download failed (HTTP ${download.status})` }
      const bytes = Buffer.from(await download.arrayBuffer())
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== expected) {
        return { ok: false, error: `checksum mismatch for ${asset}: expected ${expected}, got ${actual}` }
      }
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(temporary, bytes, { mode: 0o755 })
      chmodSync(temporary, 0o755)
      renameSync(temporary, destination)
      versionProbe = undefined
      return { ok: true, path: destination, version: PINNED_ASC_VERSION, bytes: bytes.length }
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        // best effort cleanup
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { resolve, cachedBinaryPath, version, authStatus, listApps, diagnose, provision }
}

/** Compare the provisioned pin with a discovered version (doctor detail). */
export function pinDrift(version: string | undefined): 'none' | 'older' | 'newer' | 'unknown' {
  if (version === undefined) return 'unknown'
  const comparison = compareVersions(version, PINNED_ASC_VERSION)
  if (comparison === 0) return 'none'
  return comparison < 0 ? 'older' : 'newer'
}
