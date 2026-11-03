import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { assetNameForTest, checksumsForTest } from './compat-helpers.js'
import { compatStatus, compareVersions, parseChecksums, PINNED_ASC_VERSION } from '../src/compat.js'
import { cacheRoot, createEngine, pinDrift } from '../src/control/engine.js'
import type { SpawnFn } from '../src/exec.js'
import { makeConfig } from './helpers.js'

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

  it('parses release checksum files', () => {
    const digest = 'a'.repeat(64)
    const parsed = parseChecksums(`${digest}  asc_5.16.0_macOS_arm64\n${'b'.repeat(64)} *asc_5.16.0_linux_amd64\n`)
    expect(parsed.get('asc_5.16.0_macOS_arm64')).toBe(digest)
    expect(parsed.get('asc_5.16.0_linux_amd64')).toBe('b'.repeat(64))
  })
})

describe('engine resolution', () => {
  it('prefers an explicitly configured path', () => {
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc' }), scriptedSpawn(['']).spawn)
    expect(engine.resolve()).toEqual({ path: '/opt/asc', source: 'configured' })
  })

  it('runs the same cached file when a relative cache and child cwd differ', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'asc-relative-cache-'))
    const config = makeConfig({ cacheDir: relative(process.cwd(), directory), workdir: join(directory, 'app') })
    const engine = createEngine(config, (spec) => {
      expect(resolve(spec.cwd, spec.argv[0] as string)).toBe(engine.cachedBinaryPath())
      return handle(PINNED_ASC_VERSION)
    })
    try {
      const cached = engine.cachedBinaryPath()
      mkdirSync(join(cached, '..'), { recursive: true })
      writeFileSync(cached, 'fixture')
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
    const spawn: SpawnFn = (spec) => {
      calls.push(spec)
      if (calls.length === 1) {
        const pending = handle('')
        return {
          ...pending,
          done: new Promise((resolve) => {
            spec.signal?.addEventListener('abort', () => resolve({ exitCode: null, signal: 'SIGTERM' }), { once: true })
          }),
        } as unknown as SubprocessHandle
      }
      return handle(`${PINNED_ASC_VERSION} (commit: fixture)`)
    }
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc' }), spawn)
    const diagnostic = engine.diagnose({ signal: controller.signal, checkUpdates: false })
    controller.abort()
    await expect(diagnostic).rejects.toThrow()
    expect(calls[0]?.signal?.aborted).toBe(true)
    expect(calls).toHaveLength(1)
    expect(await engine.version()).toBe(PINNED_ASC_VERSION)
    expect(calls).toHaveLength(2)
  })

  it('does not report authentication success from a failed status probe', async () => {
    let calls = 0
    const spawn: SpawnFn = () => ++calls === 1
      ? handle(PINNED_ASC_VERSION)
      : handle(JSON.stringify({ credentials: [{}], environmentCredentialsProvided: true }), 3)
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc', defaultAppId: '111' }), spawn)
    const report = await engine.diagnose({ checkUpdates: false })
    expect(report.authenticated).toBe(false)
    expect(report.checks.find((check) => check.name === 'auth')?.ok).toBe(false)
    expect(report.next?.title).not.toBe('Ready')
  })

  it('reads and caches the version', async () => {
    const { spawn, calls } = scriptedSpawn(['5.16.0 (commit: 744cce8, date: 2026-10-19T18:46:54-04:00)'])
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc' }), spawn)
    expect(await engine.version()).toBe('5.16.0')
    expect(await engine.version()).toBe('5.16.0')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('version')
  })

  it('parses auth status', async () => {
    const payload = JSON.stringify({ credentials: [{ name: 'work' }], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc' }), scriptedSpawn([payload]).spawn)
    const auth = await engine.authStatus(true)
    expect(auth.ok).toBe(true)
    expect(auth.value?.authenticated).toBe(true)
    expect(auth.value?.stored).toBe(1)
  })

  it('reports one next step when the binary is missing', async () => {
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc' }), scriptedSpawn(['', '', '']).spawn)
    const report = await engine.diagnose()
    expect(report.checks.find((check) => check.name === 'binary')?.ok).toBe(false)
    expect(report.next?.title).toMatch(/Install asc/)
    expect(report.provision.available).toBe(false)
  })

  it('reports ready when version, auth and default app are set', async () => {
    const version = `${PINNED_ASC_VERSION} (commit: abc)`
    const auth = JSON.stringify({ credentials: [{}], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(
      makeConfig({ ascPath: '/opt/asc', defaultAppId: '111' }),
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
      makeConfig({ ascPath: '/opt/asc', allowProvision: true, cacheDir }),
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
      makeConfig({ ascPath: '/opt/asc', allowProvision: true, cacheDir }),
      scriptedSpawn(['']).spawn,
    )
    const result = await engine.provision({ fetch: fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/checksum mismatch/)
  })
})

describe('update check', () => {
  it('fetches the latest release and caches it for 24 hours', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'asc-update-'))
    const engine = createEngine(makeConfig({ ascPath: '/opt/asc', cacheDir, checkUpdates: true }), scriptedSpawn(['']).spawn)
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
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(
      join(cacheDir, 'update-check.json'),
      JSON.stringify({ latest: '5.20.0', checkedAt: new Date().toISOString() }),
    )
    const version = '5.16.0 (commit: abc)'
    const auth = JSON.stringify({ credentials: [{}], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(
      makeConfig({ ascPath: '/opt/asc', defaultAppId: '111', cacheDir, checkUpdates: true }),
      scriptedSpawn([version, auth]).spawn,
    )
    const report = await engine.diagnose()
    expect(report.latestVersion).toBe('5.20.0')
    expect(report.updateAvailable).toBe(true)
    expect(report.next?.title).toMatch(/Upgrade asc/)
  })
})
