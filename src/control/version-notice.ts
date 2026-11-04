/** Advisory version checks scoped to a top-level invocation, after its guards. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { compatStatus, compareVersions, parseVersion, PINNED_ASC_VERSION, SUPPORTED_ASC_RANGE } from '../compat.js'
import type { Config } from '../config.js'
import type { AscVersionNotice } from '../format.js'
import type { EngineSnapshot } from './binary.js'
import type { AscEngine } from './engine.js'

type VersionFact = { version?: string; missing: boolean }
export interface NoticeInvocation {
  readonly signal: AbortSignal
  readonly agent?: { readonly session?: unknown } | undefined
}

function upgradeHint(source: AscVersionNotice['source'], unverified: boolean): string {
  if (unverified) return `Check plugin compatibility updates first. This plugin provisions only verified asc ${PINNED_ASC_VERSION}; do not automatically install the upstream release.`
  switch (source) {
    case 'configured': return `Update the binary selected by ascPath to verified asc ${PINNED_ASC_VERSION}, or change ascPath; /asc-doctor shows its location.`
    case 'env': return `Update the binary selected by ASC_CLI_PATH to verified asc ${PINNED_ASC_VERSION}, or change that variable; /asc-doctor shows its location.`
    case 'cache': return `The plugin cache takes precedence over PATH. To install verified asc ${PINNED_ASC_VERSION}, enable allowProvision and explicitly request asc_setup provision with confirmation and host approval.`
    case 'path': return `Update asc using its installation method to a verified version (${PINNED_ASC_VERSION}). If installed with Homebrew, brew upgrade asc updates that installation; check its target version first and run /asc-doctor afterwards.`
  }
}

/** Use only this installed plugin's facts when recommending an upgrade. */
export function versionNotice(snapshot: EngineSnapshot, fact: VersionFact, latest?: string): AscVersionNotice | undefined {
  const installed = fact.version === undefined ? undefined : parseVersion(fact.version)
  const upstream = latest === undefined ? undefined : parseVersion(latest)
  const base = {
    recommendedVersion: PINNED_ASC_VERSION, supportedRange: SUPPORTED_ASC_RANGE,
    source: snapshot.resolution.source,
    ...(installed === undefined ? {} : { installedVersion: installed }),
    ...(upstream === undefined ? {} : { latestVersion: upstream }),
  }
  if (fact.missing) return { ...base, code: 'engine-missing', message: 'The selected asc executable could not be found.', hint: upgradeHint(base.source, false) }
  if (installed === undefined || !snapshot.resolved) return {
    ...base, code: 'version-unknown', message: 'The selected asc version could not be determined.',
    hint: 'Run /asc-doctor to inspect the executable and its version; no update status is assumed.',
  }
  const status = compatStatus(installed)
  // Prereleases are not supported by the stable compatibility interval.
  if (installed.split('+')[0]?.includes('-') || status === 'newer') return {
    ...base, code: 'outside-supported-range', message: `asc ${installed} is outside the declared stable range ${SUPPORTED_ASC_RANGE}; compatibility is unconfirmed.`,
    hint: 'Check the plugin compatibility documentation or /asc-doctor. Do not automatically upgrade or downgrade the executable.',
  }
  if (status === 'older') return {
    ...base, code: 'upgrade-required', message: `asc ${installed} is below the minimum supported version; commands or flags may be unavailable. Verified recommendation: ${PINNED_ASC_VERSION}.`,
    hint: upgradeHint(base.source, false),
  }
  if (compareVersions(installed, PINNED_ASC_VERSION) < 0) return {
    ...base, code: 'upgrade-recommended', message: `asc ${installed} is in the declared range; verified asc ${PINNED_ASC_VERSION} is recommended.`,
    hint: upgradeHint(base.source, false),
  }
  if (upstream !== undefined && compareVersions(upstream, installed) > 0) return {
    ...base, code: 'upstream-unverified', message: `Upstream asc ${upstream} is available (installed ${installed}); this plugin's verified baseline is ${PINNED_ASC_VERSION}. The newer release has not been verified by this plugin.`,
    hint: upgradeHint(base.source, true),
  }
  return undefined
}

interface Check {
  snapshot: EngineSnapshot
  fact?: VersionFact
  latest?: string
  done: Promise<void>
}
interface Scope { check?: Check }
type WithNotice<T> = T & { versionNotice?: AscVersionNotice; ascVersion?: string }

/** Wait only for our budget; leave shared engine work owned by the plugin. */
async function waitForCheck(pending: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, 1_000)
    signal.addEventListener('abort', finish, { once: true })
    void pending.then(finish, finish)
  })
}

export function createVersionNotices(config: Config, engine: AscEngine) {
  const scopes = new AsyncLocalStorage<Scope>()
  const sessions = new WeakMap<object, Set<string>>()
  const fallback = new Set<string>()
  let disposed = false

  function execution(cwd: string, explicitVersion = false): EngineSnapshot | undefined {
    const scope = scopes.getStore()
    if (!config.checkUpdates || scope === undefined || disposed) return undefined
    const snapshot = engine.snapshot(cwd)
    if (scope.check?.snapshot.identity === snapshot.identity) return snapshot
    const check: Check = { snapshot, done: Promise.resolve() }
    scope.check = check
    const local = explicitVersion ? Promise.resolve() : engine.inspectVersion(snapshot)
      .then((fact) => { check.fact = fact }, () => { check.fact = { missing: false } })
    const upstream = engine.latestVersion().then((value) => {
      if (value !== undefined) check.latest = value.latest
    }, () => undefined)
    check.done = Promise.all([local, upstream]).then(() => undefined)
    return snapshot
  }

  function observedVersion(snapshot: EngineSnapshot | undefined, stdout: string): void {
    if (snapshot === undefined) return
    const version = parseVersion(stdout)
    engine.rememberVersion(snapshot, version)
    const check = scopes.getStore()?.check
    if (check?.snapshot.identity === snapshot.identity) check.fact = {
      missing: snapshot.missing, ...(version === undefined ? {} : { version }),
    }
  }

  function unseen(exec: NoticeInvocation, key: string): boolean {
    const session = exec.agent?.session
    let seen = fallback
    if ((typeof session === 'object' && session !== null) || typeof session === 'function') {
      seen = sessions.get(session) ?? new Set<string>()
      sessions.set(session, seen)
    }
    if (seen.has(key)) return false
    if (seen.size >= 128) seen.delete(seen.values().next().value as string)
    seen.add(key)
    return true
  }

  async function run<T extends object>(exec: NoticeInvocation, operation: () => Promise<T>): Promise<WithNotice<T>> {
    exec.signal.throwIfAborted()
    if (!config.checkUpdates || disposed || scopes.getStore() !== undefined) return operation()
    const scope: Scope = {}
    return scopes.run(scope, async () => {
      const result = await operation()
      const check = scope.check
      if (check === undefined || exec.signal.aborted || disposed) return result
      await waitForCheck(check.done, exec.signal)
      if (exec.signal.aborted || disposed || check.fact === undefined) return result
      const fact = check.fact
      const enriched = 'job' in result && fact.version !== undefined ? { ...result, ascVersion: fact.version } : result
      const notice = versionNotice(check.snapshot, fact, check.latest)
      if (notice === undefined) return enriched
      const key = JSON.stringify([check.snapshot.identity, notice.installedVersion, notice.code, notice.recommendedVersion, notice.latestVersion])
      if (!unseen(exec, key)) return enriched
      return { ...enriched, versionNotice: notice }
    })
  }

  return { execution, observedVersion, run, dispose: () => { disposed = true; fallback.clear() } }
}

export type VersionNotices = ReturnType<typeof createVersionNotices>
