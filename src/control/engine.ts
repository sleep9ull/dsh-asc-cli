/**
 * The engine manager: locate, diagnose and (optionally) provision `asc`.
 *
 * `asc` is an external engine, not an npm dependency. The plugin therefore
 * owns the *experience* of installing and upgrading it:
 *
 * 1. resolve a binary (configured path → `ASC_CLI_PATH` → plugin cache → PATH),
 * 2. probe its version and compare it with the declared range and tested pin,
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
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { cachedBinaryPath as binaryPath, resolveAscBinary, snapshotAscBinary, type AscResolution, type EngineSnapshot } from './binary.js'
export { cacheRoot } from './binary.js'
export type { AscSource, AscResolution, EngineSnapshot } from './binary.js'
import {
  checksumsUrl,
  compatMessage,
  compatStatus,
  compareVersions,
  parseChecksums,
  parseVersion,
  PINNED_ASC_VERSION,
  releaseAsset,
  releaseUrl,
  UPSTREAM_LATEST_URL,
  type CompatStatus,
} from '../compat.js'
import type { Config } from '../config.js'
import type { AscVersionNotice } from '../format.js'
import { versionNotice } from './version-notice.js'
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
  readonly versionNotice?: AscVersionNotice
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
  readonly versionNotice?: AscVersionNotice
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
  readonly snapshot?: EngineSnapshot
  readonly refresh?: boolean
}

export interface EngineDeps {
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

export interface VersionFact {
  readonly version?: string
  readonly missing: boolean
}

export interface DiagnoseOptions extends ProbeOptions {
  readonly validateAuth?: boolean
  readonly checkUpdates?: boolean
}

/** Asc engine surface used by commands, setup and tools. */
export interface AscEngine {
  resolve(): AscResolution
  snapshot(cwd?: string): EngineSnapshot
  inspectVersion(snapshot: EngineSnapshot, options?: ProbeOptions): Promise<VersionFact>
  rememberVersion(snapshot: EngineSnapshot, version: string | undefined): void
  dispose(): void
  cachedBinaryPath(version?: string): string
  version(options?: ProbeOptions): Promise<string | undefined>
  authStatus(validate: boolean, options?: ProbeOptions): Promise<EngineFact<AuthStatus>>
  listApps(limit: number, options?: ProbeOptions): Promise<EngineFact<readonly AppSummary[]>>
  diagnose(options?: DiagnoseOptions): Promise<DiagnoseReport>
  latestVersion(deps?: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal }): Promise<UpdateInfo | undefined>
  provision(deps?: ProvisionDeps): Promise<ProvisionResult>
}

/** Cancellation belongs to each waiter; the shared operation has its own lifetime. */
function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return pending
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    pending.then((value) => { cleanup(); resolve(value) }, (error: unknown) => { cleanup(); reject(error) })
  })
}

interface LocalVersionEntry {
  readonly controller: AbortController
  pending?: Promise<VersionFact>
  fact?: VersionFact
  checkedAt: number
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Build the engine around the plugin config and one spawn seam. */
export function createEngine(config: Config, spawn: SpawnFn, dependencies: EngineDeps = {}): AscEngine {
  const now = dependencies.now ?? Date.now
  const lifetime = new AbortController()
  const versions = new Map<string, LocalVersionEntry>()
  let lastLocalClock = now()
  let updateCache: { checkedAt: number; value?: UpdateInfo } | undefined
  let updatePending: Promise<UpdateInfo | undefined> | undefined
  let lastUpdateClock: number | undefined

  function snapshot(cwd?: string): EngineSnapshot { return snapshotAscBinary(config, cwd) }

  function invalidateVersions(): void {
    for (const entry of versions.values()) entry.controller.abort()
    versions.clear()
  }

  function dispose(): void {
    lifetime.abort()
    invalidateVersions()
    updateCache = undefined
  }

  function trimVersions(): void {
    while (versions.size > 128) {
      const oldest = versions.keys().next().value!
      versions.get(oldest)?.controller.abort()
      versions.delete(oldest)
    }
  }

  function rememberVersion(identity: EngineSnapshot, version: string | undefined): void {
    if (!identity.resolved || lifetime.signal.aborted) return
    const valid = version !== undefined && compatStatus(version) !== 'unknown' ? version : undefined
    versions.get(identity.identity)?.controller.abort()
    versions.delete(identity.identity)
    versions.set(identity.identity, {
      controller: new AbortController(), checkedAt: now(),
      fact: { ...(valid === undefined ? {} : { version: valid }), missing: false },
    })
    trimVersions()
  }

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
    const selected = options.snapshot ?? snapshot()
    const outcome = await execAsc(
      config,
      {
        argv,
        binaryPath: selected.resolution.path,
        cwd: selected.cwd,
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

  async function inspectVersion(selected: EngineSnapshot, options: ProbeOptions = {}): Promise<VersionFact> {
    options.signal?.throwIfAborted()
    if (lifetime.signal.aborted || !selected.resolved) return { missing: selected.missing }
    const current = now()
    if (current < lastLocalClock) invalidateVersions()
    lastLocalClock = current
    let entry = versions.get(selected.identity)
    if (entry?.pending !== undefined) return waitFor(entry.pending, options.signal)
    if (!options.refresh && entry?.fact !== undefined) {
      const age = current - entry.checkedAt
      const ttl = entry.fact.version === undefined ? 15_000 : 300_000
      if (age >= 0 && age < ttl) return entry.fact
    }
    entry = { controller: new AbortController(), checkedAt: current }
    versions.delete(selected.identity)
    versions.set(selected.identity, entry)
    trimVersions()
    const owned = entry
    const signal = AbortSignal.any([owned.controller.signal, lifetime.signal])
    const timer = setTimeout(() => owned.controller.abort(), 5_000)
    owned.pending = waitFor(run(['version'], { snapshot: selected, timeoutMs: 5_000, output: false, signal }), signal)
      .then((result): VersionFact => {
        const version = result.ok ? parseVersion(result.stdout) : undefined
        const missing = result.missing && snapshotAscBinary({ ...config, ascPath: selected.resolution.path }, selected.cwd).missing
        return { ...(version === undefined ? {} : { version }), missing }
      }, (): VersionFact => ({ missing: false }))
      .then((fact) => {
        clearTimeout(timer)
        if (!lifetime.signal.aborted && versions.get(selected.identity) === owned) {
          owned.fact = fact
          owned.checkedAt = now()
          delete owned.pending
        }
        return fact
      })
    return waitFor(owned.pending, options.signal)
  }

  async function version(options: ProbeOptions = {}): Promise<string | undefined> {
    return (await inspectVersion(options.snapshot ?? snapshot(), options)).version
  }

  async function authStatus(validate: boolean, options: ProbeOptions = {}): Promise<EngineFact<AuthStatus>> {
    const result = await run(['auth', 'status', ...(validate ? ['--validate'] : [])], { ...options, timeoutMs: 20_000 })
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
    const result = await run(['apps', 'list', '--limit', String(limit)], { ...options, timeoutMs: 20_000 })
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
    const selected = options.snapshot ?? snapshot()
    const resolution = selected.resolution
    const checks: DiagnoseCheck[] = []
    const fact = await inspectVersion(selected, { ...options, refresh: true })
    const found = fact.version
    options.signal?.throwIfAborted()
    checks.push({
      name: 'binary',
      ok: found !== undefined,
      detail:
        found === undefined
          ? `${fact.missing ? 'not found' : 'version unknown'} (looked for ${resolution.path}; source ${resolution.source})`
          : `${resolution.path} (source: ${resolution.source})`,
    })
    const compat = compatStatus(found)
    checks.push({ name: 'version', ok: compat === 'supported', detail: compatMessage(compat, found) })

    const probeOptions = { ...options, snapshot: selected }
    const auth = await authStatus(options.validateAuth !== false, probeOptions)
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
      const apps = await listApps(1, probeOptions)
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
        ok: latest !== undefined && !updateAvailable,
        detail:
          latest === undefined
            ? 'latest release unknown (offline or rate-limited)'
            : updateAvailable
              ? `asc ${latest.latest} is available (installed ${found}); /asc-doctor shows the upgrade path`
              : `up to date (latest ${latest.latest})`,
      })
    }

    const notice = versionNotice(selected, fact, latest?.latest)
    let next: DiagnoseNext | undefined
    if (notice !== undefined && notice.code !== 'upstream-unverified') {
      next = { title: fact.missing ? 'Install asc at the selected source' : notice.message, detail: notice.hint }
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
    } else if (notice !== undefined) {
      next = { title: notice.message, detail: notice.hint }
    } else {
      next = { title: 'Ready', detail: 'Try /asc for the capability card, or ask for a release check' }
    }

    return {
      resolution,
      ...(notice === undefined ? {} : { versionNotice: notice }),
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

  async function latestVersion(
    deps: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal } = {},
  ): Promise<UpdateInfo | undefined> {
    deps.signal?.throwIfAborted()
    if (!config.checkUpdates || lifetime.signal.aborted) return undefined
    const clock = deps.now ?? now
    const current = clock()
    if (lastUpdateClock !== undefined && current < lastUpdateClock) updateCache = undefined
    lastUpdateClock = current
    if (updatePending !== undefined) return waitFor(updatePending, deps.signal)
    if (updateCache !== undefined) {
      const age = current - updateCache.checkedAt
      const ttl = updateCache.value === undefined ? 900_000 : 86_400_000
      if (age >= 0 && age < ttl) {
        return updateCache.value === undefined ? undefined : { ...updateCache.value, cached: true }
      }
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, lifetime.signal])
    const timer = setTimeout(() => controller.abort(), 5_000)
    const fetchImpl = deps.fetch ?? dependencies.fetch ?? fetch
    const request = async (): Promise<UpdateInfo | undefined> => {
      const response = await fetchImpl(UPSTREAM_LATEST_URL, {
        headers: { accept: 'application/vnd.github+json' }, signal,
      })
      if (!response.ok) return undefined
      const payload = recordOf(await response.json())
      const tag = typeof payload.tag_name === 'string' ? payload.tag_name : ''
      // Release API tags must be a complete version, not version-command prose.
      if (compatStatus(tag) === 'unknown' || payload.draft === true || payload.prerelease === true) return undefined
      const latest = parseVersion(tag)
      if (latest === undefined) return undefined
      return { latest, checkedAt: new Date(clock()).toISOString(), cached: false }
    }
    updatePending = waitFor(request(), signal).catch(() => undefined).then((value) => {
      clearTimeout(timer)
      if (!lifetime.signal.aborted) updateCache = { checkedAt: clock(), ...(value === undefined ? {} : { value }) }
      updatePending = undefined
      return value
    })
    return waitFor(updatePending, deps.signal)
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
      invalidateVersions()
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

  return { resolve, snapshot, inspectVersion, rememberVersion, dispose, cachedBinaryPath, version, authStatus, listApps, diagnose, latestVersion, provision }
}

/** Compare the provisioned pin with a discovered version (doctor detail). */
export function pinDrift(version: string | undefined): 'none' | 'older' | 'newer' | 'unknown' {
  if (compatStatus(version) === 'unknown' || version === undefined) return 'unknown'
  const comparison = compareVersions(version, PINNED_ASC_VERSION)
  if (comparison === 0) return 'none'
  return comparison < 0 ? 'older' : 'newer'
}
