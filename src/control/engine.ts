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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { cacheRoot, cachedBinaryPath as binaryPath, resolveAscBinary, type AscResolution } from './binary.js'
export { cacheRoot } from './binary.js'
export type { AscSource, AscResolution } from './binary.js'
import {
  checksumsUrl,
  compatMessage,
  compatStatus,
  compareVersions,
  parseChecksums,
  PINNED_ASC_VERSION,
  releaseAsset,
  releaseUrl,
  UPSTREAM_LATEST_URL,
  type CompatStatus,
} from '../compat.js'
import type { Config } from '../config.js'
import { execAsc, type SpawnFn } from '../exec.js'

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
  readonly latestVersion?: string
  readonly updateAvailable?: boolean
  readonly next?: DiagnoseNext
}

/** Result of the optional upstream update check. */
export interface UpdateInfo {
  readonly latest: string
  readonly checkedAt: string
  readonly cached: boolean
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
  readonly signal?: AbortSignal
}

export interface ProbeOptions {
  readonly signal?: AbortSignal
}

export interface DiagnoseOptions extends ProbeOptions {
  readonly validateAuth?: boolean
  readonly checkUpdates?: boolean
}

/** Asc engine surface used by commands, setup and tools. */
export interface AscEngine {
  resolve(): AscResolution
  cachedBinaryPath(version?: string): string
  version(options?: ProbeOptions): Promise<string | undefined>
  authStatus(validate: boolean, options?: ProbeOptions): Promise<EngineFact<AuthStatus>>
  listApps(limit: number, options?: ProbeOptions): Promise<EngineFact<readonly AppSummary[]>>
  diagnose(options?: DiagnoseOptions): Promise<DiagnoseReport>
  latestVersion(deps?: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal }): Promise<UpdateInfo | undefined>
  provision(deps?: ProvisionDeps): Promise<ProvisionResult>
}

function firstSemver(text: string): string | undefined {
  const version = /^v?(\S+)/.exec(text.trim())?.[1]
  return compatStatus(version) === 'unknown' ? undefined : version
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Build the engine around the plugin config and one spawn seam. */
export function createEngine(config: Config, spawn: SpawnFn): AscEngine {
  let versionProbe: Promise<string | undefined> | undefined
  let versionProbePath: string | undefined

  function cachedBinaryPath(version: string = PINNED_ASC_VERSION): string {
    return binaryPath(config, version)
  }

  function resolve(): AscResolution {
    return resolveAscBinary(config)
  }

  async function run(
    argv: readonly string[],
    options: ProbeOptions & { timeoutMs?: number; output?: boolean } = {},
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
        signal: options.signal,
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

  async function version(options: ProbeOptions = {}): Promise<string | undefined> {
    options.signal?.throwIfAborted()
    const probe = () => run(['version'], { timeoutMs: 15_000, output: false, signal: options.signal }).then((result) =>
      result.ok ? firstSemver(result.stdout) : undefined,
    )
    // A cancellable invocation owns its child; do not share its cancellation or
    // cache its failed result with later invocations.
    if (options.signal !== undefined) return probe()
    const path = resolve().path
    if (path !== versionProbePath) versionProbe = undefined
    versionProbePath = path
    const pending = versionProbe ??= probe()
    const found = await pending
    if (found === undefined && versionProbe === pending) versionProbe = undefined
    return found
  }

  async function authStatus(validate: boolean, options: ProbeOptions = {}): Promise<EngineFact<AuthStatus>> {
    const result = await run(['auth', 'status', ...(validate ? ['--validate'] : [])], { timeoutMs: 20_000, signal: options.signal })
    if (result.missing) return { ok: false, error: 'asc binary not found' }
    const data = recordOf(result.data)
    const credentials = Array.isArray(data.credentials) ? data.credentials : []
    const environmentProvided = data.environmentCredentialsProvided === true
    const status: AuthStatus = {
      stored: credentials.length,
      ...(typeof data.storageBackend === 'string' ? { storage: data.storageBackend } : {}),
      environmentProvided,
      authenticated: result.ok && !(typeof data.validationFailures === 'number' && data.validationFailures > 0) &&
        (credentials.length > 0 || (environmentProvided && data.environmentCredentialsComplete !== false)),
    }
    if (!result.ok) {
      return { ok: false, value: status, error: result.stderr.trim() || `auth status exited with an error` }
    }
    return { ok: true, value: status }
  }

  async function listApps(limit: number, options: ProbeOptions = {}): Promise<EngineFact<readonly AppSummary[]>> {
    const result = await run(['apps', 'list', '--limit', String(limit)], { timeoutMs: 20_000, signal: options.signal })
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

  async function diagnose(options: DiagnoseOptions = {}): Promise<DiagnoseReport> {
    options.signal?.throwIfAborted()
    const resolution = resolve()
    const checks: DiagnoseCheck[] = []
    const found = await version(options)
    options.signal?.throwIfAborted()
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

    const auth = await authStatus(options.validateAuth !== false, options)
    options.signal?.throwIfAborted()
    const authenticated = auth.ok && auth.value?.authenticated === true
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
      const apps = await listApps(1, options)
      options.signal?.throwIfAborted()
      if (apps.ok && apps.value?.[0] !== undefined) firstApp = apps.value[0]
    }

    const provision = {
      available: config.allowProvision && releaseAsset(PINNED_ASC_VERSION) !== undefined,
      pinned: PINNED_ASC_VERSION,
      cached: existsSync(cachedBinaryPath()),
    }

    let latest: UpdateInfo | undefined
    let updateAvailable = false
    if (config.checkUpdates && options.checkUpdates !== false && found !== undefined) {
      latest = await latestVersion({ signal: options.signal })
      options.signal?.throwIfAborted()
      updateAvailable = latest !== undefined && compareVersions(found, latest.latest) < 0
      checks.push({
        name: 'upstream',
        ok: !updateAvailable,
        detail:
          latest === undefined
            ? 'latest release unknown (offline or rate-limited)'
            : updateAvailable
              ? `asc ${latest.latest} is available (installed ${found}); /asc-doctor shows the upgrade path`
              : `up to date (latest ${latest.latest})`,
      })
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
            ? 'ask for `asc action: "apps-list"` to find an app id'
            : `first available: ${firstApp.name ?? firstApp.id} (${firstApp.id})`,
      }
    } else if (updateAvailable) {
      next = {
        title: 'Upgrade asc (optional)',
        command: 'brew upgrade asc',
        detail: `asc ${latest?.latest} is available; the prompt is advisory and never auto-upgrades`,
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
      ...(latest === undefined ? {} : { latestVersion: latest.latest }),
      ...(updateAvailable ? { updateAvailable: true } : {}),
      ...(next === undefined ? {} : { next }),
    }
  }

  const UPDATE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

  async function latestVersion(
    deps: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal } = {},
  ): Promise<UpdateInfo | undefined> {
    deps.signal?.throwIfAborted()
    const cachePath = join(cacheRoot(config), 'update-check.json')
    const now = deps.now ?? Date.now
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { latest?: unknown; checkedAt?: unknown }
      if (
        typeof cached.latest === 'string' &&
        typeof cached.checkedAt === 'string' &&
        now() - Date.parse(cached.checkedAt) < UPDATE_CACHE_MAX_AGE_MS
      ) {
        return { latest: cached.latest, checkedAt: cached.checkedAt, cached: true }
      }
    } catch {
      // Missing or unreadable cache: fetch below.
    }
    const fetchImpl = deps.fetch ?? fetch
    try {
      const response = await fetchImpl(UPSTREAM_LATEST_URL, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(deps.signal === undefined ? [] : [deps.signal])]),
      })
      if (!response.ok) return undefined
      const payload = (await response.json()) as { tag_name?: unknown }
      const tag = typeof payload.tag_name === 'string' ? payload.tag_name : ''
      const latest = firstSemver(tag)
      if (latest === undefined) return undefined
      deps.signal?.throwIfAborted()
      const checkedAt = new Date(now()).toISOString()
      try {
        mkdirSync(cacheRoot(config), { recursive: true })
        writeFileSync(cachePath, `${JSON.stringify({ latest, checkedAt })}\n`)
      } catch {
        // Cache writes are best-effort.
      }
      return { latest, checkedAt, cached: false }
    } catch {
      return undefined
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
      deps.signal?.throwIfAborted()
      const signal = (timeoutMs: number) => AbortSignal.any([
        ...(deps.signal === undefined ? [] : [deps.signal]), AbortSignal.timeout(timeoutMs),
      ])
      const listing = await fetchImpl(checksumsUrl(PINNED_ASC_VERSION), { signal: signal(20_000) })
      if (!listing.ok) return { ok: false, error: `checksum list download failed (HTTP ${listing.status})` }
      const expected = parseChecksums(await listing.text()).get(asset)
      if (expected === undefined) return { ok: false, error: `checksum list does not contain ${asset}` }

      deps.signal?.throwIfAborted()
      const download = await fetchImpl(releaseUrl(asset, PINNED_ASC_VERSION), { signal: signal(180_000) })
      if (!download.ok) return { ok: false, error: `binary download failed (HTTP ${download.status})` }
      const bytes = Buffer.from(await download.arrayBuffer())
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== expected) {
        return { ok: false, error: `checksum mismatch for ${asset}: expected ${expected}, got ${actual}` }
      }
      deps.signal?.throwIfAborted()
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(temporary, bytes, { mode: 0o755 })
      chmodSync(temporary, 0o755)
      deps.signal?.throwIfAborted()
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

  return { resolve, cachedBinaryPath, version, authStatus, listApps, diagnose, latestVersion, provision }
}

/** Compare the provisioned pin with a discovered version (doctor detail). */
export function pinDrift(version: string | undefined): 'none' | 'older' | 'newer' | 'unknown' {
  if (compatStatus(version) === 'unknown' || version === undefined) return 'unknown'
  const comparison = compareVersions(version, PINNED_ASC_VERSION)
  if (comparison === 0) return 'none'
  return comparison < 0 ? 'older' : 'newer'
}
