import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { buildSpawnSpec, childEnv, execAsc, globalFlags, type SpawnFn } from '../src/exec.js'
import { makeConfig } from './helpers.js'

interface FakeResult {
  stdout?: string
  stderr?: string
  exitCode?: number | null
  signal?: string | null
  lossy?: boolean
  spillPath?: string
}

function collect(text: string, lossy = false, spillPath?: string) {
  return {
    readFrom: () => ({
      text,
      nextOffset: text.length,
      lossy,
      ...(spillPath === undefined ? {} : { spillPath }),
    }),
  }
}

function fakeSpawn(result: FakeResult): { spawn: SpawnFn; spec: () => SubprocessSpawnSpec } {
  let captured: SubprocessSpawnSpec | undefined
  const spawn: SpawnFn = (spec) => {
    captured = spec
    const handle = {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {
        stdout: collect(result.stdout ?? '', result.lossy ?? false, result.spillPath),
        stderr: collect(result.stderr ?? ''),
      },
      done: Promise.resolve({ exitCode: result.exitCode ?? 0, signal: result.signal ?? null }),
      terminate: () => undefined,
      waitForExit: async () => true,
    } as unknown as SubprocessHandle
    return handle
  }
  return {
    spawn,
    spec: () => {
      if (!captured) throw new Error('spawn was not called')
      return captured
    },
  }
}

describe('exec protocol', () => {
  it('adds global read-only flags, JSON output and scrubbed env defaults', () => {
    const config = makeConfig({ profile: 'work' })
    const flags = globalFlags(config)
    expect(flags).toEqual(['--profile', 'work', '--read-only'])
    const env = childEnv(config)
    expect(env.ASC_READ_ONLY).toBe('1')
    expect(env.ASC_TELEMETRY_DISABLED).toBe('1')

    const request = { argv: ['apps', 'list'], cwd: '/tmp', timeoutMs: 1_000, maxBytes: 4_096 }
    const spec = buildSpawnSpec(config, request, new AbortController().signal)
    expect(spec.argv).toEqual(['asc', '--profile', 'work', '--read-only', 'apps', 'list', '--output', 'json'])
    expect(spec.cwd).toBe('/tmp')
    expect(spec.stdio.stdin).toBe('ignore')
  })

  it('omits --read-only in write mode', () => {
    const config = makeConfig({ mode: 'write' })
    expect(globalFlags(config)).toEqual([])
    expect(childEnv(config).ASC_READ_ONLY).toBeUndefined()
  })

  it('parses JSON on success', async () => {
    const fake = fakeSpawn({ stdout: '{"data":[{"id":"1"}]}' })
    const result = await execAsc(
      makeConfig(),
      { argv: ['apps', 'list'], cwd: '/tmp', timeoutMs: 1_000, maxBytes: 4_096 },
      fake.spawn,
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ data: [{ id: '1' }] })
    expect(result.parseFailed).toBe(false)
  })

  it('keeps exit facts for failures', async () => {
    const fake = fakeSpawn({ stdout: '', stderr: 'HTTP 401 Unauthorized', exitCode: 1 })
    const result = await execAsc(
      makeConfig(),
      { argv: ['apps', 'list'], cwd: '/tmp', timeoutMs: 1_000, maxBytes: 4_096 },
      fake.spawn,
    )
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('401')
  })

  it('reports truncation and spill paths', async () => {
    const fake = fakeSpawn({ stdout: '{"data":[]}', lossy: true, spillPath: '/tmp/out.json' })
    const result = await execAsc(
      makeConfig(),
      { argv: ['apps', 'list'], cwd: '/tmp', timeoutMs: 1_000, maxBytes: 4_096 },
      fake.spawn,
    )
    expect(result.truncated).toBe(true)
    expect(result.spillPath).toBe('/tmp/out.json')
  })

  it('enforces the deadline and terminates the child', async () => {
    let terminated = false
    const spawn: SpawnFn = (spec) => {
      const handle = {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: {
          stdout: collect(''),
          stderr: collect(''),
        },
        done: new Promise((resolve) => {
          spec.signal?.addEventListener('abort', () => {
            terminated = true
            resolve({ exitCode: null, signal: 'SIGTERM' })
          })
        }),
        terminate: () => undefined,
        waitForExit: async () => true,
      } as unknown as SubprocessHandle
      return handle
    }

    const result = await execAsc(
      makeConfig(),
      { argv: ['status', '--app', '1'], cwd: '/tmp', timeoutMs: 20, maxBytes: 4_096 },
      spawn,
    )
    expect(result.timedOut).toBe(true)
    expect(result.ok).toBe(false)
    expect(terminated).toBe(true)
  })

  it('returns a structured error when the binary is missing', async () => {
    const spawn = vi.fn<SpawnFn>(() => {
      throw new Error('spawn asc ENOENT')
    })
    const result = await execAsc(
      makeConfig(),
      { argv: ['version'], cwd: '/tmp', timeoutMs: 1_000, maxBytes: 4_096 },
      spawn,
    )
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('ENOENT')
  })
})
