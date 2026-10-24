import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AscToolResult } from '../src/format.js'
import type { AscEngine } from '../src/control/engine.js'
import { jobIds, jobSpecFor, runJob, runReadOnlyArgv, type JobArgs, type JobContext } from '../src/jobs.js'
import { makeConfig } from './helpers.js'

function result(overrides: Partial<AscToolResult> = {}): AscToolResult {
  return { ok: true, exitCode: 0, command: 'asc', durationMs: 5, summary: 'step done', ...overrides }
}

function context(options: {
  mode?: 'read-only' | 'write'
  defaultAppId?: string
  runAction?: (tool: string, action: string | undefined, args: Record<string, unknown>) => Promise<AscToolResult>
  runArgv?: (argv: readonly string[]) => Promise<AscToolResult>
} = {}): { ctx: JobContext; runAction: ReturnType<typeof vi.fn>; runArgv: ReturnType<typeof vi.fn> } {
  const runAction = vi.fn(
    options.runAction ??
      (async () => result()),
  )
  const runArgv = vi.fn(options.runArgv ?? (async () => result({ data: { data: [] } })))
  const engine = { version: async () => '5.16.0' } as unknown as AscEngine
  return {
    runAction,
    runArgv,
    ctx: {
      config: makeConfig({ mode: options.mode ?? 'write', defaultAppId: options.defaultAppId ?? '111' }),
      exec: { signal: new AbortController().signal } as unknown as ToolRunContext,
      runtime: { runAction: runAction as never, runArgv: runArgv as never },
      engine,
    },
  }
}

function args(overrides: Partial<JobArgs> = {}): JobArgs {
  return { confirm: true, ...overrides }
}

describe('job registry', () => {
  it('exposes the four documented jobs', () => {
    expect(jobIds()).toEqual([
      'release-check',
      'ship-testflight',
      'stage-release',
      'triage-feedback',
      'compliance-sweep',
    ])
    expect(jobSpecFor('release-check')?.risk).toBe('read')
    expect(jobSpecFor('stage-release')?.needsConfirm).toBe(true)
    expect(jobSpecFor('nope')).toBeUndefined()
  })
})

describe('release-check', () => {
  it('runs validate in read-only mode and returns the readiness summary', async () => {
    const { ctx, runAction } = context({ runAction: async () => result({ summary: 'blocking=1' }) })
    const outcome = await runJob('release-check', args({ confirm: false }), {
      ...ctx,
      config: { ...ctx.config, mode: 'read-only' },
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.steps[0]?.name).toBe('validate')
    expect(runAction).toHaveBeenCalledWith('asc_plan', 'validate', { app: '111' }, expect.anything())
    expect(outcome.ascVersion).toBe('5.16.0')
  })

  it('reports a failed validate', async () => {
    const { ctx } = context({
      runAction: async () =>
        result({ ok: false, exitCode: 1, summary: 'auth failed', errorClass: 'auth', hint: 'fix auth' }),
    })
    const outcome = await runJob('release-check', args({ confirm: false }), ctx)
    expect(outcome.ok).toBe(false)
    expect(outcome.errorClass).toBe('auth')
    expect(outcome.hint).toBe('fix auth')
  })
})

describe('ship-testflight', () => {
  it('is blocked in read-only mode', async () => {
    const { ctx } = context()
    await expect(runJob('ship-testflight', args({ file: 'a.ipa' }), { ...ctx, config: { ...ctx.config, mode: 'read-only' } })).rejects.toThrow(
      /read-only mode/,
    )
  })

  it('requires confirm', async () => {
    const { ctx } = context()
    await expect(runJob('ship-testflight', { file: 'a.ipa' }, ctx)).rejects.toThrow(/confirm: true/)
  })

  it('uploads, extracts buildId and adds the build to a group', async () => {
    const { ctx, runAction } = context({
      runAction: async (tool, action) =>
        action === 'upload' ? result({ summary: 'uploaded', data: { buildId: 'b1' } }) : result({ summary: 'group added' }),
    })
    const outcome = await runJob('ship-testflight', args({ file: 'a.ipa', group: 'Internal', submit: true }), ctx)
    expect(outcome.ok).toBe(true)
    expect(runAction).toHaveBeenNthCalledWith(
      1,
      'asc_apply',
      'upload',
      expect.objectContaining({ app: '111', file: 'a.ipa', wait: true }),
      expect.anything(),
    )
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      'asc_apply',
      'groups',
      expect.objectContaining({ group: 'Internal', buildId: 'b1', submit: true, confirm: true }),
      expect.anything(),
    )
    expect(outcome.data).toEqual({ buildId: 'b1', group: 'Internal' })
  })

  it('does not touch groups in a dry run', async () => {
    const { ctx, runAction } = context()
    const outcome = await runJob('ship-testflight', args({ file: 'a.ipa', group: 'Internal', dryRun: true }), ctx)
    expect(outcome.ok).toBe(true)
    expect(runAction).toHaveBeenCalledTimes(1)
    expect(outcome.steps).toHaveLength(1)
    expect(outcome.dryRun).toBe(true)
  })

  it('explains a missing buildId instead of silently skipping the group', async () => {
    const { ctx } = context({ runAction: async () => result({ data: {} }) })
    const outcome = await runJob('ship-testflight', args({ file: 'a.ipa', group: 'Internal' }), ctx)
    expect(outcome.ok).toBe(false)
    expect(outcome.steps[1]?.name).toBe('add-groups')
    expect(outcome.steps[1]?.summary).toMatch(/buildId/)
  })
})

describe('stage-release', () => {
  it('does not stage when validate fails', async () => {
    const { ctx, runAction } = context({
      runAction: async () => result({ ok: false, exitCode: 1, summary: 'not ready', errorClass: 'usage' }),
    })
    const outcome = await runJob('stage-release', args({ version: '1.2.3', buildId: 'b1' }), ctx)
    expect(outcome.ok).toBe(false)
    expect(runAction).toHaveBeenCalledTimes(1)
    expect(outcome.steps.map((step) => step.name)).toEqual(['validate'])
  })

  it('validates, then stages with confirm for a real run', async () => {
    const { ctx, runAction } = context()
    const outcome = await runJob('stage-release', args({ version: '1.2.3', buildId: 'b1', metadataDir: './metadata' }), ctx)
    expect(outcome.ok).toBe(true)
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      'asc_apply',
      'stage',
      expect.objectContaining({ version: '1.2.3', buildId: 'b1', metadataDir: './metadata', confirm: true }),
      expect.anything(),
    )
  })

  it('uses --dry-run instead of confirm for a preview', async () => {
    const { ctx, runAction } = context()
    await runJob('stage-release', args({ version: '1.2.3', buildId: 'b1', dryRun: true }), ctx)
    const stageArgs = runAction.mock.calls[1]?.[2] as Record<string, unknown>
    expect(stageArgs.dryRun).toBe(true)
    expect(stageArgs.confirm).toBeUndefined()
  })
})

describe('triage-feedback', () => {
  it('counts feedback, crashes and reviews', async () => {
    const { ctx, runAction } = context({
      runAction: async (tool, action) =>
        result({ data: { data: action === 'testflight-feedback' ? [{}, {}] : action === 'reviews-list' ? [{}, {}, {}] : [{}] } }),
    })
    const outcome = await runJob('triage-feedback', args({ confirm: false }), {
      ...ctx,
      config: { ...ctx.config, mode: 'read-only' },
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toContain('feedback=2')
    expect(outcome.summary).toContain('crashes=1')
    expect(outcome.summary).toContain('reviews=3')
    expect(runAction).toHaveBeenCalledWith(
      'asc',
      'reviews-list',
      expect.objectContaining({ app: '111', limit: 20 }),
      expect.anything(),
    )
  })

  it('treats reviews as optional', async () => {
    const { ctx } = context({
      runAction: async (tool, action) =>
        action === 'reviews-list'
          ? result({ ok: false, exitCode: 1, summary: 'reviews unavailable', errorClass: 'unknown' })
          : result({ data: { data: [] } }),
    })
    const outcome = await runJob('triage-feedback', args({ confirm: false }), ctx)
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toContain('reviews=n/a')
  })
})


describe('compliance-sweep', () => {
  it('probes age rating, encryption, accessibility and pricing as read-only argv', async () => {
    const { ctx, runArgv } = context({
      runArgv: async () => result({ summary: 'probe ok', data: { data: [] } }),
    })
    const outcome = await runJob('compliance-sweep', args({ confirm: false }), {
      ...ctx,
      config: { ...ctx.config, mode: 'read-only' },
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.steps.map((step) => step.name)).toEqual([
      'age-rating',
      'encryption',
      'accessibility',
      'pricing',
    ])
    expect(runArgv).toHaveBeenCalledWith(
      ['age-rating', 'view', '--app', '111'],
      { confirm: false },
      expect.anything(),
    )
    expect(outcome.summary).toContain('compliance:')
  })

  it('refuses to run a mutating command through the read-only helper', async () => {
    const { ctx, runArgv } = context()
    const step = await runReadOnlyArgv(ctx, 'probe', ['age-rating', 'edit', '--app', '111'])
    expect(step.ok).toBe(false)
    expect(step.summary).toMatch(/only runs read-only/)
    expect(runArgv).not.toHaveBeenCalled()
  })
})
