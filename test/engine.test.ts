import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    expect(compatStatus('5.16.0')).toBe('supported')
    expect(compatStatus('5.15.0')).toBe('older')
    expect(compatStatus('6.0.0')).toBe('newer')
    expect(compatStatus(undefined)).toBe('unknown')
    expect(pinDrift('5.16.0')).toBe('none')
    expect(pinDrift('6.0.0')).toBe('newer')
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
    const version = '5.16.0 (commit: abc)'
    const auth = JSON.stringify({ credentials: [{}], storageBackend: 'System Keychain', environmentCredentialsProvided: false })
    const engine = createEngine(
      makeConfig({ ascPath: '/opt/asc', defaultAppId: '111' }),
      scriptedSpawn([version, auth]).spawn,
    )
    const report = await engine.diagnose()
    expect(report.version).toBe('5.16.0')
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
