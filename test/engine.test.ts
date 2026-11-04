import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { assetNameForTest, checksumsForTest } from './compat-helpers.js'
import { compatStatus, compareVersions, parseChecksums, parseVersion, PINNED_ASC_VERSION } from '../src/compat.js'
import { cacheRoot, createEngine, pinDrift } from '../src/control/engine.js'
import type { SpawnFn } from '../src/exec.js'
import { makeConfig } from './helpers.js'

let testHome: string
beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'asc-engine-home-'))
  vi.stubEnv('DSH_HOME', testHome)
  vi.stubEnv('ASC_CLI_PATH', '')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network is not available in tests') }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

function handle(stdout: string, exitCode = 0) {
  const collect = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: { stdout: collect(stdout), stderr: collect('') },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => undefined,
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
}

function scriptedSpawn(outputs: string[]): { spawn: SpawnFn; calls: string[][] } {
  const calls: string[][] = []
  const spawn: SpawnFn = (spec: SubprocessSpawnSpec) => {
    calls.push([...spec.argv])
    const next = outputs[Math.min(calls.length - 1, outputs.length - 1)] ?? ''
    return handle(next)
  }
  return { spawn, calls }
}

describe('compatibility helpers', () => {
  it('compares versions and classifies the tested range', () => {
    expect(compareVersions('5.16.0', '5.16.0')).toBe(0)
    expect(compareVersions('5.15.9', '5.16.0')).toBe(-1)
    expect(compareVersions('6.0.0', '5.16.0')).toBe(1)
    expect(compatStatus('6.3.0')).toBe('supported')
    expect(compatStatus('6.2.9')).toBe('older')
    expect(compatStatus('6.99.0')).toBe('supported')
    expect(compatStatus('7.0.0')).toBe('newer')
    expect(compatStatus(undefined)).toBe('unknown')
    expect(compatStatus('not-a-version')).toBe('unknown')
    expect(compatStatus('6.3.0oops')).toBe('unknown')
    expect(pinDrift(PINNED_ASC_VERSION)).toBe('none')
    expect(pinDrift('7.0.0')).toBe('newer')
    expect(pinDrift('bad')).toBe('unknown')
  })

  it('orders prereleases without mistaking malformed versions for equal', () => {
    const ordered = ['6.3.0-alpha', '6.3.0-alpha.1', '6.3.0-alpha.beta', '6.3.0-beta', '6.3.0-beta.2', '6.3.0-beta.11', '6.3.0-rc.1', '6.3.0']
    for (let i = 1; i < ordered.length; i++) expect(compareVersions(ordered[i - 1]!, ordered[i]!)).toBe(-1)
    expect(compareVersions('6.3.0+build.1', '6.3.0+build.2')).toBe(0)
    expect(compatStatus('6.4.0-rc.1')).toBe('prerelease')
    for (const malformed of ['6.3.0-01', '6.3.0-a..b', '6.3.0+', '6.3.0+build..1', '06.3.0', 'bad']) {
      expect(compatStatus(malformed)).toBe('unknown')
      expect(compareVersions(malformed, '6.3.0')).toBeNaN()
      expect(parseVersion(malformed)).toBeUndefined()
    }
    expect(parseVersion('v6.3.0 (commit: fixture)')).toBe('6.3.0')
    expect(parseVersion('asc version 6.3.0')).toBeUndefined()
  })

  it('parses release checksum files', () => {
    const digest = 'a'.repeat(64)
    const parsed = parseChecksums(`${digest}  asc_5.16.0_macOS_arm64\n${'b'.repeat(64)} *asc_5.16.0_linux_amd64\n`)
    expect(parsed.get('asc_5.16.0_macOS_arm64')).toBe(digest)
    expect(parsed.get('asc_5.16.0_linux_amd64')).toBe('b'.repeat(64))
  })
})

describe('engine resolution', () => {
  it('prefers an explicitly configured path', () => {
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), scriptedSpawn(['']).spawn)
    expect(engine.resolve()).toEqual({ path: process.execPath, source: 'configured' })
  })

  it('runs the same cached file when a relative cache and child cwd differ', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'asc-relative-cache-'))
    const config = makeConfig({ cacheDir: relative(process.cwd(), directory), workdir: join(directory, 'app') })
    const engine = createEngine(config, (spec) => {
      expect(realpathSync(resolve(spec.cwd, spec.argv[0] as string))).toBe(realpathSync(engine.cachedBinaryPath()))
      return handle(PINNED_ASC_VERSION)
    })
    try {
      const cached = engine.cachedBinaryPath()
      mkdirSync(join(cached, '..'), { recursive: true })
      writeFileSync(cached, 'fixture')
      chmodSync(cached, 0o755)
      expect(await engine.version()).toBe(PINNED_ASC_VERSION)
      expect(isAbsolute(engine.resolve().path)).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('falls back to ASC_CLI_PATH, then the cache, then PATH', () => {
    vi.stubEnv('ASC_CLI_PATH', '/env/asc')
    try {
      const fromEnv = createEngine(makeConfig(), scriptedSpawn(['']).spawn)
      expect(fromEnv.resolve()).toEqual({ path: '/env/asc', source: 'env' })
    } finally {
      vi.unstubAllEnvs()
    }

    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-cache-'))
    const config = makeConfig({ cacheDir })
    const engine = createEngine(config, scriptedSpawn(['']).spawn)
    expect(engine.resolve()).toEqual({ path: 'asc', source: 'path' })
    const cached = engine.cachedBinaryPath()
    mkdirSync(join(cached, '..'), { recursive: true })
    writeFileSync(cached, 'binary')
    expect(engine.resolve()).toEqual({ path: cached, source: 'cache' })
    expect(cacheRoot(config)).toBe(cacheDir)
  })
})

describe('engine probes', () => {
  it('cancels diagnostic probes without poisoning the next version probe', async () => {
    const controller = new AbortController()
    const calls: SubprocessSpawnSpec[] = []
    let finish!: () => void
    const spawn: SpawnFn = (spec) => {
      calls.push(spec)
      return {
        ...handle(`${PINNED_ASC_VERSION} (commit: fixture)`),
        done: new Promise((resolve) => { finish = () => resolve({ exitCode: 0, signal: null }) }),
      } as unknown as SubprocessHandle
    }
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), spawn)
    const diagnostic = engine.diagnose({ signal: controller.signal, checkUpdates: false })
    controller.abort()
    await expect(diagnostic).rejects.toThrow()
    expect(calls[0]?.signal?.aborted).toBe(false)
    expect(calls).toHaveLength(1)
    finish()
    expect(await engine.version()).toBe(PINNED_ASC_VERSION)
    expect(calls).toHaveLength(1)
  })

  it('does not report authentication success from a failed status probe', async () => {
    let calls = 0
    const spawn: SpawnFn = () => ++calls === 1
      ? handle(PINNED_ASC_VERSION)
      : handle(JSON.stringify({ credentials: [{}], environmentCredentialsProvided: true }), 3)
    const engine = createEngine(makeConfig({ ascPath: process.execPath, defaultAppId: '111' }), spawn)
    const report = await engine.diagnose({ checkUpdates: false })
    expect(report.authenticated).toBe(false)
    expect(report.checks.find((check) => check.name === 'auth')?.ok).toBe(false)
    expect(report.next?.title).not.toBe('Ready')
  })

  it('reads and caches the version', async () => {
    const { spawn, calls } = scriptedSpawn(['5.16.0 (commit: 744cce8, date: 2026-10-19T18:46:54-04:00)'])
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), spawn)
    expect(await engine.version()).toBe('5.16.0')
    expect(await engine.version()).toBe('5.16.0')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('version')
  })

  it('parses auth status', async () => {
    const payload = JSON.stringify({ credentials: [{ name: 'work' }], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), scriptedSpawn([payload]).spawn)
    const auth = await engine.authStatus(true)
    expect(auth.ok).toBe(true)
    expect(auth.value?.authenticated).toBe(true)
    expect(auth.value?.stored).toBe(1)
  })

  it('reports one next step when the binary is missing', async () => {
    const engine = createEngine(makeConfig({ ascPath: join(tmpdir(), 'asc-missing-fixture', 'asc') }), scriptedSpawn(['', '', '']).spawn)
    const report = await engine.diagnose()
    expect(report.checks.find((check) => check.name === 'binary')?.ok).toBe(false)
    expect(report.next?.title).toMatch(/Install asc/)
    expect(report.provision.available).toBe(false)
  })

  it.each([
    ['6.2.0', 'upgrade-required'],
    ['7.0.0', 'outside-supported-range'],
    ['invalid output', 'version-unknown'],
  ])('diagnoses %s without claiming ready or suggesting a blind install', async (version, code) => {
    const engine = createEngine(makeConfig({ ascPath: process.execPath, defaultAppId: '111' }),
      scriptedSpawn([version, JSON.stringify({ credentials: [{}] })]).spawn)
    const report = await engine.diagnose()
    expect(report.versionNotice?.code).toBe(code)
    expect(report.next?.title).not.toBe('Ready')
    expect(report.next?.command).toBeUndefined()
    expect(report.next?.detail).toBe(report.versionNotice?.hint)
  })

  it('keeps diagnostic auth probes on the selected cwd and gives unverified-latest guidance', async () => {
    const calls: SubprocessSpawnSpec[] = []
    const engine = createEngine(makeConfig({ ascPath: process.execPath, checkUpdates: true, defaultAppId: '111' }), spec => {
      calls.push(spec)
      return handle(spec.argv.includes('version') ? PINNED_ASC_VERSION : JSON.stringify({ credentials: [{}] }))
    }, { fetch: async () => new Response(JSON.stringify({ tag_name: '7.0.0' })) })
    const selected = engine.snapshot(testHome)
    const report = await engine.diagnose({ snapshot: selected })
    expect(calls.map(call => [call.argv[0], call.cwd])).toEqual([
      [selected.resolution.path, selected.cwd], [selected.resolution.path, selected.cwd],
    ])
    expect(report.versionNotice?.code).toBe('upstream-unverified')
    expect(report.next?.command).toBeUndefined()
    expect(report.next?.detail).toBe(report.versionNotice?.hint)
  })

  it('reports ready when version, auth and default app are set', async () => {
    const version = `${PINNED_ASC_VERSION} (commit: abc)`
    const auth = JSON.stringify({ credentials: [{}], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(
      makeConfig({ ascPath: process.execPath, defaultAppId: '111' }),
      scriptedSpawn([version, auth]).spawn,
    )
    const report = await engine.diagnose()
    expect(report.version).toBe(PINNED_ASC_VERSION)
    expect(report.compat).toBe('supported')
    expect(report.authenticated).toBe(true)
    expect(report.next?.title).toBe('Ready')
  })
})

describe('provisioning', () => {
  it('refuses when allowProvision is disabled', async () => {
    const engine = createEngine(makeConfig({ cacheDir: mkdtempSync(join(tmpdir(), 'asc-cache-')) }), scriptedSpawn(['']).spawn)
    const result = await engine.provision()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/allowProvision/)
  })

  it('downloads, verifies the checksum and installs the binary', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-cache-'))
    const asset = assetNameForTest()
    const bytes = Buffer.from('fake-asc-binary')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target.endsWith('checksums.txt')) return new Response(checksumsForTest(asset, digest), { status: 200 })
      return new Response(bytes, { status: 200 })
    }) as unknown as typeof fetch
    const engine = createEngine(
      makeConfig({ ascPath: process.execPath, allowProvision: true, cacheDir }),
      scriptedSpawn(['']).spawn,
    )
    const result = await engine.provision({ fetch: fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.version).toBe(PINNED_ASC_VERSION)
    expect(result.bytes).toBe(bytes.length)
    expect(readFileSync(result.path as string)).toEqual(bytes)
  })

  it.each(['before-fetch', 'checksums', 'binary', 'body'])('does not install after cancellation during %s', async (phase) => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-cancel-provision-'))
    const controller = new AbortController()
    const bytes = Buffer.from('replacement')
    const asset = assetNameForTest()
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const checksums = String(url).endsWith('checksums.txt')
      if ((phase === 'checksums' && checksums) || (phase === 'binary' && !checksums)) {
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          controller.abort(new Error('cancelled fixture'))
          // Do not hang the red test if caller cancellation was not forwarded.
          if (!init?.signal?.aborted) reject(new Error('caller signal was not forwarded'))
        })
      }
      if (checksums) return new Response(checksumsForTest(asset, digest))
      return {
        ok: true,
        arrayBuffer: async () => { controller.abort(new Error('cancelled fixture')); return bytes },
      } as unknown as Response
    })
    const engine = createEngine(makeConfig({ allowProvision: true, cacheDir }), scriptedSpawn(['']).spawn)
    const destination = engine.cachedBinaryPath()
    mkdirSync(join(destination, '..'), { recursive: true })
    writeFileSync(destination, 'existing-engine')
    if (phase === 'before-fetch') controller.abort(new Error('cancelled fixture'))
    try {
      const result = await engine.provision({ fetch: fetchImpl, signal: controller.signal })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('cancelled fixture')
      expect(readFileSync(destination, 'utf8')).toBe('existing-engine')
      expect(existsSync(`${destination}.download`)).toBe(false)
      if (phase === 'before-fetch') expect(fetchImpl).not.toHaveBeenCalled()
      if (phase === 'checksums') expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally { rmSync(cacheDir, { recursive: true, force: true }) }
  })

  it('rejects a checksum mismatch', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-cache-'))
    const asset = assetNameForTest()
    const fetchImpl = (async (url: string | URL | Request) =>
      String(url).endsWith('checksums.txt')
        ? new Response(checksumsForTest(asset, 'c'.repeat(64)), { status: 200 })
        : new Response(Buffer.from('tampered'), { status: 200 })) as unknown as typeof fetch
    const engine = createEngine(
      makeConfig({ ascPath: process.execPath, allowProvision: true, cacheDir }),
      scriptedSpawn(['']).spawn,
    )
    const result = await engine.provision({ fetch: fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum mismatch/)
  })
})

describe('version cache lifecycle', () => {
  it('refreshes explicit diagnosis and invalidates previous facts after provisioning', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-invalidate-'))
    const { spawn, calls } = scriptedSpawn(['6.3.0', '6.4.0', '{}', '6.5.0'])
    const engine = createEngine(makeConfig({ ascPath: process.execPath, allowProvision: true, cacheDir }), spawn)
    try {
      expect(await engine.version()).toBe('6.3.0')
      expect((await engine.diagnose({ checkUpdates: false })).version).toBe('6.4.0')
      const bytes = Buffer.from('verified replacement')
      const digest = createHash('sha256').update(bytes).digest('hex')
      const installed = await engine.provision({ fetch: async (url) => String(url).endsWith('checksums.txt')
        ? new Response(checksumsForTest(assetNameForTest(), digest)) : new Response(bytes) })
      expect(installed.ok).toBe(true)
      // Even an explicitly configured path's old facts must be discarded after provision.
      expect(await engine.version()).toBe('6.5.0')
      expect(calls).toHaveLength(4)
    } finally { rmSync(cacheDir, { recursive: true, force: true }) }
  })

  it('does not share facts between cwd snapshots and rechecks changed files', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'asc-local-cache-')))
    const first = join(root, 'one'), second = join(root, 'two')
    for (const folder of [first, second]) {
      mkdirSync(folder)
      writeFileSync(join(folder, 'asc'), 'fixture')
      chmodSync(join(folder, 'asc'), 0o755)
    }
    const { spawn, calls } = scriptedSpawn(['6.3.0', '6.4.0', '6.5.0'])
    const engine = createEngine(makeConfig({ ascPath: './asc' }), spawn)
    try {
      expect(await engine.version({ snapshot: engine.snapshot(first) })).toBe('6.3.0')
      expect(await engine.version({ snapshot: engine.snapshot(second) })).toBe('6.4.0')
      writeFileSync(join(first, 'asc'), 'changed fixture content')
      expect(await engine.version({ snapshot: engine.snapshot(first) })).toBe('6.5.0')
      expect(calls.map((call) => call[0])).toEqual([join(first, 'asc'), join(second, 'asc'), join(first, 'asc')])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('expires local successes and failures, refreshes explicitly and isolates identities', async () => {
    let now = 0
    const { spawn, calls } = scriptedSpawn(['6.3.0', 'bad', '6.4.0', '6.5.0'])
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), spawn, { now: () => now })
    expect(await engine.version()).toBe('6.3.0')
    now = 299_999
    expect(await engine.version()).toBe('6.3.0')
    now = 300_000
    expect(await engine.version()).toBeUndefined()
    expect(await engine.version()).toBeUndefined()
    expect(calls).toHaveLength(2)
    now += 15_000
    expect(await engine.version()).toBe('6.4.0')
    expect(await engine.version({ refresh: true })).toBe('6.5.0')
    now = 0
    await engine.version()
    expect(calls).toHaveLength(5)
  })

  it('does not call an existing engine missing when spawn fails for another path', async () => {
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), () => { throw new Error('spawn ENOENT: working directory not found') })
    expect(await engine.inspectVersion(engine.snapshot())).toEqual({ missing: false })
  })

  it('does not probe an uncertain executable or reuse a known version for it', async () => {
    const { spawn, calls } = scriptedSpawn(['6.3.0'])
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), spawn)
    const snapshot = engine.snapshot()
    engine.rememberVersion(snapshot, '6.3.0')
    expect(await engine.inspectVersion({ ...snapshot, resolved: false, missing: false })).toEqual({ missing: false })
    expect(calls).toHaveLength(0)
    expect(await engine.version()).toBe('6.3.0')
    expect(calls).toHaveLength(0)
  })

  it('shares probes while one cancelled waiter cannot cancel the other', async () => {
    let finish!: () => void
    const calls: SubprocessSpawnSpec[] = []
    const spawn: SpawnFn = (spec) => {
      calls.push(spec)
      return { ...handle('6.3.0'), done: new Promise((resolve) => { finish = () => resolve({ exitCode: 0, signal: null }) }) } as SubprocessHandle
    }
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), spawn)
    const controller = new AbortController()
    const cancelled = engine.version({ signal: controller.signal })
    const surviving = engine.version()
    controller.abort()
    await expect(cancelled).rejects.toThrow()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal?.aborted).toBe(false)
    finish()
    expect(await surviving).toBe('6.3.0')
    expect(await engine.version()).toBe('6.3.0')
  })

  it('remembers explicit versions without cancelling shared probes or overwriting the fresh fact', async () => {
    let finish!: () => void
    const calls: SubprocessSpawnSpec[] = []
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), (spec) => {
      calls.push(spec)
      return { ...handle('6.3.0'), done: new Promise((resolve) => { finish = () => resolve({ exitCode: 0, signal: null }) }) } as SubprocessHandle
    })
    try {
      const selected = engine.snapshot()
      const controller = new AbortController()
      const cancelled = engine.inspectVersion(selected, { signal: controller.signal })
      const first = engine.inspectVersion(selected)
      const second = engine.inspectVersion(selected)
      engine.rememberVersion(selected, '6.4.0')
      controller.abort()
      await expect(cancelled).rejects.toThrow()
      expect(await engine.inspectVersion(selected)).toEqual({ version: '6.4.0', missing: false })
      finish()
      expect(await Promise.all([first, second])).toEqual([
        { version: '6.3.0', missing: false },
        { version: '6.3.0', missing: false },
      ])
      expect(calls[0]?.signal?.aborted).toBe(false)
      expect(await engine.inspectVersion(selected)).toEqual({ version: '6.4.0', missing: false })
      expect(calls).toHaveLength(1)
    } finally { engine.dispose() }
  })

  it.each(['timeout', 'dispose', 'provision'])('still aborts detached probes on %s', async (reason) => {
    vi.useFakeTimers()
    const calls: SubprocessSpawnSpec[] = []
    const engine = createEngine(makeConfig({ ascPath: process.execPath, allowProvision: true, cacheDir: testHome }), (spec) => {
      calls.push(spec)
      return { ...handle('6.3.0'), done: new Promise((resolve) => spec.signal?.addEventListener('abort', () => resolve({ exitCode: null, signal: 'SIGTERM' }), { once: true })) } as SubprocessHandle
    })
    try {
      const selected = engine.snapshot()
      const first = engine.inspectVersion(selected)
      engine.rememberVersion(selected, '6.4.0')
      const second = engine.inspectVersion(selected, { refresh: true })
      engine.rememberVersion(selected, '6.5.0')
      await vi.advanceTimersByTimeAsync(4_999)
      expect(calls).toHaveLength(2)
      expect(calls.map(call => call.signal?.aborted)).toEqual([false, false])
      if (reason === 'timeout') {
        await vi.advanceTimersByTimeAsync(1)
      } else if (reason === 'dispose') {
        engine.dispose()
      } else {
        const bytes = Buffer.from('verified replacement')
        const digest = createHash('sha256').update(bytes).digest('hex')
        expect((await engine.provision({ fetch: async (url) => String(url).endsWith('checksums.txt')
          ? new Response(checksumsForTest(assetNameForTest(), digest)) : new Response(bytes) })).ok).toBe(true)
      }
      expect(await Promise.all([first, second])).toEqual([{ missing: false }, { missing: false }])
      expect(calls.map(call => call.signal?.aborted)).toEqual([true, true])
      expect(vi.getTimerCount()).toBe(0)
      if (reason === 'timeout') {
        expect(await engine.inspectVersion(selected)).toEqual({ version: '6.5.0', missing: false })
        expect(calls).toHaveLength(2)
      }
    } finally { engine.dispose(); vi.useRealTimers() }
  })

  it('bounds hanging probes and aborts pending probes on disposal', async () => {
    vi.useFakeTimers()
    const calls: SubprocessSpawnSpec[] = []
    const spawn: SpawnFn = (spec) => {
      calls.push(spec)
      return { ...handle(''), done: new Promise((resolve) => spec.signal?.addEventListener('abort', () => resolve({ exitCode: null, signal: 'SIGTERM' }), { once: true })) } as SubprocessHandle
    }
    const engine = createEngine(makeConfig({ ascPath: process.execPath }), spawn)
    try {
      const timed = engine.version()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await timed).toBeUndefined()
      expect(calls[0]?.signal?.aborted).toBe(true)
      const disposed = engine.version({ refresh: true })
      engine.dispose()
      expect(await disposed).toBeUndefined()
      expect(calls[1]?.signal?.aborted).toBe(true)
      expect(await engine.version()).toBeUndefined()
      expect(calls).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })
})

describe('update check', () => {
  it('never reads or writes legacy disk metadata and obeys checkUpdates=false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asc-no-cache-write-'))
    const legacy = join(root, 'update-check.json')
    const original = JSON.stringify({ latest: '99.0.0', checkedAt: new Date().toISOString() })
    writeFileSync(legacy, original)
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ tag_name: '6.4.0' })))
    try {
      const config = makeConfig({ cacheDir: root, checkUpdates: true })
      const engine = createEngine(config, scriptedSpawn(['']).spawn, { fetch: fetchImpl })
      expect((await engine.latestVersion())?.latest).toBe('6.4.0')
      expect(readFileSync(legacy, 'utf8')).toBe(original)
      const empty = join(root, 'not-created')
      await createEngine({ ...config, cacheDir: empty }, scriptedSpawn(['']).spawn, { fetch: fetchImpl }).latestVersion()
      expect(existsSync(empty)).toBe(false)
      chmodSync(root, 0o555)
      try {
        expect((await createEngine(config, scriptedSpawn(['']).spawn, { fetch: fetchImpl }).latestVersion())?.latest).toBe('6.4.0')
        expect(readdirSync(root)).toEqual(['update-check.json'])
        expect(readFileSync(legacy, 'utf8')).toBe(original)
      } finally { chmodSync(root, 0o700) }
      fetchImpl.mockClear()
      expect(await createEngine({ ...config, checkUpdates: false }, scriptedSpawn(['']).spawn, { fetch: fetchImpl }).latestVersion()).toBeUndefined()
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('expires successes, suppresses failures, rejects malformed tags and invalidates clock rollback', async () => {
    let now = 0
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: '6.4.0' })))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: '6.4.0-01' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: '6.5.0' })))
    const engine = createEngine(makeConfig({ checkUpdates: true }), scriptedSpawn(['']).spawn, { fetch: fetchImpl, now: () => now })
    expect((await engine.latestVersion())?.latest).toBe('6.4.0')
    now = 86_399_999
    expect((await engine.latestVersion())?.cached).toBe(true)
    now++
    expect(await engine.latestVersion()).toBeUndefined()
    now += 899_999
    expect(await engine.latestVersion()).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    now++
    expect(await engine.latestVersion()).toBeUndefined()
    now--
    expect((await engine.latestVersion())?.latest).toBe('6.5.0')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('shares remote requests, isolates waiter cancellation and aborts on disposal', async () => {
    let finish!: (response: Response) => void
    let sharedSignal: AbortSignal | null | undefined
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      sharedSignal = init?.signal
      return new Promise<Response>((resolve) => { finish = resolve })
    })
    const engine = createEngine(makeConfig({ checkUpdates: true }), scriptedSpawn(['']).spawn, { fetch: fetchImpl })
    const controller = new AbortController()
    const cancelled = engine.latestVersion({ signal: controller.signal })
    const survivor = engine.latestVersion()
    controller.abort()
    await expect(cancelled).rejects.toThrow()
    expect(sharedSignal?.aborted).toBe(false)
    finish(new Response(JSON.stringify({ tag_name: '6.4.0' })))
    expect((await survivor)?.latest).toBe('6.4.0')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const another = createEngine(makeConfig({ checkUpdates: true }), scriptedSpawn(['']).spawn, { fetch: fetchImpl })
    const pending = another.latestVersion()
    another.dispose()
    expect(await pending).toBeUndefined()
    expect(sharedSignal?.aborted).toBe(true)
  })

  it('bounds pending response bodies and reports upstream failure as unknown', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | null | undefined
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      requestSignal = init?.signal
      return { ok: true, json: async () => new Promise(() => undefined) } as unknown as Response
    })
    const engine = createEngine(makeConfig({ ascPath: process.execPath, checkUpdates: true }), scriptedSpawn(['6.3.0', '{}']).spawn, { fetch: fetchImpl })
    try {
      const pending = engine.latestVersion()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(await pending).toBeUndefined()
      expect(requestSignal?.aborted).toBe(true)
      const report = await engine.diagnose()
      expect(report.checks.find((check) => check.name === 'upstream')).toMatchObject({ ok: false })
      expect(report.checks.find((check) => check.name === 'upstream')?.detail).not.toMatch(/up to date/i)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally { engine.dispose(); vi.useRealTimers() }
  })

  it('fetches the latest release and caches it for 24 hours', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-update-'))
    const engine = createEngine(makeConfig({ ascPath: process.execPath, cacheDir, checkUpdates: true }), scriptedSpawn(['']).spawn)
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ tag_name: 'v5.20.0' }), { status: 200 })) as unknown as typeof fetch
    const first = await engine.latestVersion({ fetch: fetchImpl, now: () => Date.parse('2026-10-24T00:00:00Z') })
    expect(first?.latest).toBe('5.20.0')
    expect(first?.cached).toBe(false)

    const second = await engine.latestVersion({
      fetch: (async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
      now: () => Date.parse('2026-10-24T01:00:00Z'),
    })
    expect(second?.cached).toBe(true)
    expect(second?.latest).toBe('5.20.0')
  })

  it('reports an available upgrade from the cached result', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-update-'))
    const version = '5.16.0 (commit: abc)'
    const auth = JSON.stringify({ credentials: [{}], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(
      makeConfig({ ascPath: process.execPath, defaultAppId: '111', cacheDir, checkUpdates: true }),
      scriptedSpawn([version, auth]).spawn,
      { fetch: async () => new Response(JSON.stringify({ tag_name: '5.20.0' })) },
    )
    await engine.latestVersion()
    const report = await engine.diagnose()
    expect(report.latestVersion).toBe('5.20.0')
    expect(report.updateAvailable).toBe(true)
    expect(report.versionNotice).toMatchObject({ code: 'upgrade-required', recommendedVersion: PINNED_ASC_VERSION, source: 'configured' })
    expect(report.next?.detail).toBe(report.versionNotice?.hint)
    expect(report.next?.command).toBeUndefined()
  })
})
