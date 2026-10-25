import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AuditEntry } from '../src/audit.js'
import { createRuntime, shouldRetryWithoutOutput } from '../src/runtime.js'
import type { SpawnFn } from '../src/exec.js'
import { makeConfig } from './helpers.js'

function fakeCtx(): Context {
  return {
    reflect: { get: () => undefined },
    subprocess: {
      spawn: () => {
        throw new Error('unexpected default spawn')
      },
    },
  } as unknown as Context
}

function execContext(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

function handleFor(exitCode: number, stdout = '', stderr = '') {
  const collect = (text: string) => ({
    readFrom: () => ({ text, nextOffset: text.length, lossy: false }),
  })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: { stdout: collect(stdout), stderr: collect(stderr) },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => undefined,
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
}

function queuedSpawn(outcomes: Array<{ exitCode: number; stdout?: string; stderr?: string }>): {
  spawn: SpawnFn
  calls: string[][]
} {
  const calls: string[][] = []
  const spawn: SpawnFn = (spec) => {
    calls.push([...spec.argv])
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)] ?? { exitCode: 0 }
    return handleFor(next.exitCode, next.stdout ?? '', next.stderr ?? '')
  }
  return { spawn, calls }
}

describe('generic command policy', () => {
  it('refuses forbidden commands before spawning', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    await expect(runtime.runArgv(['auth', 'login'], { confirm: true }, execContext())).rejects.toThrow(/not exposed/)
    expect(calls).toHaveLength(0)
  })

  it('refuses App Store Connect mutations in read-only mode', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    await expect(
      runtime.runArgv(['builds', 'upload', '--app', '1', '--ipa', 'a.ipa'], { confirm: true }, execContext()),
    ).rejects.toThrow(/read-only mode/)
    expect(calls).toHaveLength(0)
  })

  it('runs an unrecognized command in read-only mode when the policy asks, not denies', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0, stdout: '{"ok":true}' }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    const result = await runtime.runArgv(['frobnicate', 'now'], { confirm: false }, execContext())
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('--read-only')
  })

  it('refuses unrecognized commands in read-only mode under unknownCommands=deny', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp', unknownCommands: 'deny' }), spawn)
    await expect(runtime.runArgv(['frobnicate', 'now'], { confirm: false }, execContext())).rejects.toThrow(
      /unknownCommands/,
    )
    expect(calls).toHaveLength(0)
  })

  it('requires confirm for local writes', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    await expect(runtime.runArgv(['docs', 'init'], { confirm: false }, execContext())).rejects.toThrow(/local files/)
    expect(calls).toHaveLength(0)
  })

  it('skips --output up front for roots that reject it', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0, stdout: 'ASC.md written' }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    const result = await runtime.runArgv(['docs', 'init'], { confirm: true }, execContext())
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('--output')
  })

  it('retries an exit-2 failure once without --output', async () => {
    const { spawn, calls } = queuedSpawn([
      { exitCode: 2, stderr: 'accepts exactly one guide name' },
      { exitCode: 0, stdout: 'guide text' },
    ])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    const result = await runtime.runArgv(['schema', 'list'], { confirm: false }, execContext())
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('--output')
    expect(calls[1]).not.toContain('--output')
  })
})

describe('file-writing leaves and audit context', () => {
  it('does not append --output json to a file-writing leaf', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    const result = await runtime.runArgv(
      ['analytics', 'download', '--request-id', 'R', '--instance-id', 'I'],
      { confirm: true },
      execContext(),
    )
    expect(result.ok).toBe(true)
    expect(calls[0]).not.toContain('--output')
  })

  it('recognizes a file-writing leaf behind a leading global flag', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    await runtime.runArgv(
      ['--profile', 'p', 'screenshots', 'download', '--id', '1'],
      { confirm: true },
      execContext(),
    )
    expect(calls[0]).not.toContain('--output')
  })

  it('recognizes a no-output root behind a leading global flag', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0, stdout: 'ASC.md written' }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    await runtime.runArgv(['--debug', 'docs', 'init'], { confirm: true }, execContext())
    expect(calls[0]).not.toContain('--output')
  })

  it('labels the command with the argv that actually ran after a retry', async () => {
    const { spawn } = queuedSpawn([
      { exitCode: 2, stderr: 'accepts exactly one guide name' },
      { exitCode: 0, stdout: 'guide text' },
    ])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    const result = await runtime.runArgv(['schema', 'list'], { confirm: false }, execContext())
    expect(result.command).not.toMatch(/--output json/)
  })

  it('records the app id from args, argv, or the configured default', async () => {
    const entries: AuditEntry[] = []
    const { spawn } = queuedSpawn([{ exitCode: 0, stdout: '{"data":[]}' }])
    const config = makeConfig({ workdir: '/tmp', defaultAppId: '999' })
    const runtime = createRuntime(fakeCtx(), config, spawn, (entry) => entries.push(entry))

    await runtime.runAction('asc', 'apps-list', { app: '42', confirm: false }, execContext())
    await runtime.runArgv(['apps', 'list', '--app', '77'], { confirm: false }, execContext())
    await runtime.runArgv(['version'], { confirm: false }, execContext())

    expect(entries.map((entry) => entry.appId)).toEqual(['42', '77', '999'])
  })

  it('omits the app id when nothing identifies an app', async () => {
    const entries: AuditEntry[] = []
    const { spawn } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn, (entry) => entries.push(entry))
    await runtime.runArgv(['version'], { confirm: false }, execContext())
    expect(entries[0]?.appId).toBeUndefined()
  })

  it('refuses forbidden commands behind a leading global flag before spawning', async () => {
    const { spawn, calls } = queuedSpawn([{ exitCode: 0 }])
    const runtime = createRuntime(fakeCtx(), makeConfig({ workdir: '/tmp' }), spawn)
    await expect(
      runtime.runArgv(['--debug', 'auth', 'token'], { confirm: true }, execContext()),
    ).rejects.toThrow(/not exposed/)
    expect(calls).toHaveLength(0)
  })
})

describe('shouldRetryWithoutOutput', () => {
  const outcome = (overrides: Record<string, unknown> = {}) =>
    ({
      ok: false,
      exitCode: 2,
      exitSignal: null,
      durationMs: 1,
      timedOut: false,
      aborted: false,
      stdout: '',
      stderr: '',
      truncated: false,
      parseFailed: false,
      ...overrides,
    }) as Parameters<typeof shouldRetryWithoutOutput>[1]

  it('only retries when output was attempted and the exit is a usage failure', () => {
    expect(shouldRetryWithoutOutput(true, outcome())).toBe(true)
    expect(shouldRetryWithoutOutput(false, outcome())).toBe(false)
    expect(shouldRetryWithoutOutput(true, outcome({ ok: true }))).toBe(false)
    expect(shouldRetryWithoutOutput(true, outcome({ exitCode: 1 }))).toBe(false)
    expect(shouldRetryWithoutOutput(true, outcome({ timedOut: true }))).toBe(false)
  })
})
