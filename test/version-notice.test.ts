import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVersionNotices, versionNotice } from '../src/control/version-notice.js'
import type { AscEngine } from '../src/control/engine.js'
import type { EngineSnapshot } from '../src/control/binary.js'
import { renderResult, type AscToolResult } from '../src/format.js'
import { makeConfig } from './helpers.js'
import { PINNED_ASC_VERSION } from '../src/compat.js'

const snapshot: EngineSnapshot = {
  resolution: { path: '/fixture/asc', source: 'configured' }, identity: 'binary-one',
  cwd: '/fixture', resolved: true, missing: false,
}
const outcome: AscToolResult = { ok: false, exitCode: 3, command: 'asc apps', durationMs: 2, summary: 'auth failed', errorClass: 'auth', hint: 'fix auth' }
function fixture() {
  const engine = {
    snapshot: vi.fn(() => snapshot),
    inspectVersion: vi.fn(async () => ({ version: '5.99.0', missing: false })),
    latestVersion: vi.fn(async () => ({ latest: '7.0.0', checkedAt: new Date().toISOString(), cached: false })),
    rememberVersion: vi.fn(),
  } as unknown as AscEngine
  const notices = createVersionNotices(makeConfig({ checkUpdates: true }), engine)
  const session = {}
  const exec = { signal: new AbortController().signal, agent: { session } }
  const run = () => { notices.execution('/fixture'); return Promise.resolve(outcome) }
  return { engine, notices, exec, run }
}
afterEach(() => vi.useRealTimers())

describe('version notices', () => {
  it('preserves business failure and displays a source-aware advisory once per session', async () => {
    const { notices, exec, run } = fixture()
    const first = await notices.run(exec, run)
    expect(first).toMatchObject(outcome)
    expect(first.versionNotice).toMatchObject({ code: 'upgrade-required', recommendedVersion: PINNED_ASC_VERSION, source: 'configured' })
    expect(first.versionNotice?.hint).not.toContain('brew upgrade')
    expect(renderResult(first).map((part) => part.type === 'text' ? part.text : '').join('')).toContain(first.versionNotice?.message)
    expect((await notices.run(exec, run)).versionNotice).toBeUndefined()
    expect((await notices.run({ ...exec, agent: { session: {} } }, run)).versionNotice?.code).toBe('upgrade-required')
  })

  it('does not treat a new upstream major or prerelease as a verified upgrade', () => {
    expect(versionNotice(snapshot, { version: PINNED_ASC_VERSION, missing: false }, '7.0.0')).toMatchObject({ code: 'upstream-unverified', recommendedVersion: PINNED_ASC_VERSION })
    expect(versionNotice(snapshot, { version: '6.4.0-rc.1', missing: false }, '6.4.0')?.code).toBe('outside-supported-range')
    expect(versionNotice(snapshot, { version: 'garbage', missing: false }, '7.0.0')?.code).toBe('version-unknown')
    expect(versionNotice(snapshot, { version: PINNED_ASC_VERSION, missing: false })).toBeUndefined()
    for (const version of ['6.0.0', '6.2.0', '6.3.0']) {
      expect(versionNotice(snapshot, { version, missing: false })).toMatchObject({ code: 'upgrade-recommended', recommendedVersion: PINNED_ASC_VERSION })
    }
    const cached = versionNotice({ ...snapshot, resolution: { ...snapshot.resolution, source: 'cache' } }, { version: PINNED_ASC_VERSION, missing: false }, '7.0.0')
    expect(cached?.hint).not.toContain('brew')
    expect(cached?.hint).toContain(PINNED_ASC_VERSION)
  })

  it('does not probe rejected operations, cancelled callers or disabled checks', async () => {
    const { engine, notices, exec, run } = fixture()
    await expect(notices.run(exec, async () => { throw new Error('denied') })).rejects.toThrow('denied')
    await expect(notices.run({ ...exec, signal: AbortSignal.abort() }, run)).rejects.toThrow()
    expect(engine.inspectVersion).not.toHaveBeenCalled()
    const disabled = createVersionNotices(makeConfig({ checkUpdates: false }), engine)
    await disabled.run(exec, async () => { disabled.execution('/fixture'); return outcome })
    expect(engine.inspectVersion).not.toHaveBeenCalled()
    expect(engine.latestVersion).not.toHaveBeenCalled()
  })

  it('bounds extra waiting and leaves the notice available to the next call', async () => {
    vi.useFakeTimers()
    const { engine, notices, exec, run } = fixture()
    let finish!: (value: { version: string; missing: boolean }) => void
    const pending = new Promise<{ version: string; missing: boolean }>((resolve) => { finish = resolve })
    vi.mocked(engine.inspectVersion).mockReturnValue(pending)
    const first = notices.run(exec, run)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await first).toEqual(outcome)
    finish({ version: '5.99.0', missing: false })
    await Promise.resolve()
    expect((await notices.run(exec, run)).versionNotice?.code).toBe('upgrade-required')
  })

  it('uses local compatibility facts even when upstream fetch has not completed', async () => {
    vi.useFakeTimers()
    const { engine, notices, exec, run } = fixture()
    vi.mocked(engine.latestVersion).mockReturnValue(new Promise(() => {}))
    const result = notices.run(exec, run)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await result).versionNotice?.code).toBe('upgrade-required')
  })

  it('keeps nested job steps from consuming the top-level notice', async () => {
    const { notices, exec, run } = fixture()
    const result = await notices.run(exec, async () => {
      const step = await notices.run(exec, run)
      expect(step.versionNotice).toBeUndefined()
      return { ok: true, job: 'release-check', steps: [step] }
    })
    expect(result.versionNotice?.code).toBe('upgrade-required')
    expect(result.ascVersion).toBe('5.99.0')
  })

  it('reuses an explicit version result and does not spawn another version probe', async () => {
    const { engine, notices, exec } = fixture()
    const result = await notices.run(exec, async () => {
      const selected = notices.execution('/fixture', true)
      notices.observedVersion(selected, '5.99.0 (commit: fixture)')
      return { ok: true, text: '5.99.0 (commit: fixture)' }
    })
    expect(engine.inspectVersion).not.toHaveBeenCalled()
    expect(engine.rememberVersion).toHaveBeenCalledWith(snapshot, '5.99.0')
    expect(result.versionNotice?.code).toBe('upgrade-required')
  })

  it('returns promptly on cancellation without consuming another caller’s notice', async () => {
    vi.useFakeTimers()
    const { engine, notices, exec, run } = fixture()
    let finish!: (value: { version: string; missing: boolean }) => void
    vi.mocked(engine.inspectVersion).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const cancelled = notices.run({ ...exec, signal: controller.signal }, run)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    expect(await cancelled).toEqual(outcome)
    finish({ version: '5.99.0', missing: false })
    expect((await notices.run(exec, run)).versionNotice?.code).toBe('upgrade-required')
    notices.dispose()
    expect(await notices.run({ ...exec, agent: { session: {} } }, run)).toEqual(outcome)
  })

  it('deduplicates concurrent returns and allows a changed binary to notify again', async () => {
    const { engine, notices, exec, run } = fixture()
    const values = await Promise.all([notices.run(exec, run), notices.run(exec, run)])
    expect(values.filter((value) => value.versionNotice)).toHaveLength(1)
    vi.mocked(engine.snapshot).mockReturnValue({ ...snapshot, identity: 'replacement' })
    expect((await notices.run(exec, run)).versionNotice?.code).toBe('upgrade-required')
  })
})
