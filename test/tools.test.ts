import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AscEngine } from '../src/control/engine.js'
import type { AscToolResult } from '../src/format.js'
import type { AscRuntime } from '../src/runtime.js'
import { registerApplyTool } from '../src/tools/apply.js'
import { registerAscTool } from '../src/tools/asc.js'
import { registerJobTool } from '../src/tools/job.js'
import { registerPlanTool } from '../src/tools/plan.js'
import { registerSetupTool } from '../src/tools/setup.js'
import { makeConfig, makeExec } from './helpers.js'

function result(overrides: Partial<AscToolResult> = {}): AscToolResult {
  return { ok: true, exitCode: 0, command: 'asc', durationMs: 1, summary: 'ok', ...overrides }
}

/**
 * Capture the definition each `register*Tool` hands to `ctx.tools.register`
 * and stub the runtime so no process, network or filesystem is touched.
 */
function harness(): {
  ctx: Context
  runtime: AscRuntime
  registered: Map<string, ToolDefinition>
  runAction: ReturnType<typeof vi.fn>
  runArgv: ReturnType<typeof vi.fn>
  engine: AscEngine
  exec: ToolRunContext
} {
  const registered = new Map<string, ToolDefinition>()
  const ctx = {
    effect(register: () => unknown) {
      register()
      return () => undefined
    },
    tools: {
      register(tool: ToolDefinition) {
        registered.set(tool.name, tool)
        return () => undefined
      },
    },
  } as unknown as Context
  const runAction = vi.fn(async () => result())
  const runArgv = vi.fn(async () => result())
  const runtime = {
    config: makeConfig({ mode: 'write', longTimeoutMs: 1_000 }),
    runAction,
    runArgv,
  } as unknown as AscRuntime
  const engine = {
    version: async () => '5.16.0',
    diagnose: async () => ({ resolution: 'ok', checks: [] }),
    provision: async () => ({ ok: true }),
  } as unknown as AscEngine
  return { ctx, runtime, registered, runAction, runArgv, engine, exec: makeExec() as unknown as ToolRunContext }
}

function toolOf(registered: Map<string, ToolDefinition>, name: string): ToolDefinition {
  const tool = registered.get(name)
  if (!tool) throw new Error(`${name} tool not registered`)
  return tool
}

describe('tool registration', () => {
  it('asc forwards `run` argv to runArgv', async () => {
    const h = harness()
    registerAscTool(h.ctx, h.runtime)
    await toolOf(h.registered, 'asc').execute(
      { action: 'run', args: ['apps', 'list', '--limit', '5'] },
      h.exec,
    )
    expect(h.runArgv).toHaveBeenCalledWith(
      ['apps', 'list', '--limit', '5'],
      expect.objectContaining({ confirm: false }),
      h.exec,
    )
  })

  it('asc_plan forwards a typed action to runAction', async () => {
    const h = harness()
    registerPlanTool(h.ctx, h.runtime)
    await toolOf(h.registered, 'asc_plan').execute(
      { action: 'validate', app: '111', version: '1.2.3' },
      h.exec,
    )
    expect(h.runAction).toHaveBeenCalledWith(
      'asc_plan',
      'validate',
      expect.objectContaining({ action: 'validate', app: '111', version: '1.2.3' }),
      h.exec,
    )
  })

  it('asc_apply forwards publish with an ipa and no version', async () => {
    const h = harness()
    registerApplyTool(h.ctx, h.runtime)
    await toolOf(h.registered, 'asc_apply').execute(
      { action: 'publish', ipa: '/tmp/App.ipa', confirm: true },
      h.exec,
    )
    expect(h.runAction).toHaveBeenCalledWith(
      'asc_apply',
      'publish',
      expect.objectContaining({ action: 'publish', ipa: '/tmp/App.ipa', confirm: true }),
      h.exec,
    )
  })

  it('asc_setup forwards version to runAction', async () => {
    const h = harness()
    registerSetupTool(h.ctx, h.runtime, h.engine)
    await toolOf(h.registered, 'asc_setup').execute({ action: 'version' }, h.exec)
    expect(h.runAction).toHaveBeenCalledWith(
      'asc_setup',
      'version',
      expect.objectContaining({ action: 'version' }),
      h.exec,
    )
  })
})

describe('asc_job tool', () => {
  it('passes copyMetadataFrom through to the stage step', async () => {
    const h = harness()
    registerJobTool(h.ctx, h.runtime, h.engine)
    await toolOf(h.registered, 'asc_job').execute(
      { action: 'stage-release', app: '111', version: '1.2.3', buildId: 'b1', copyMetadataFrom: '1.1.0', confirm: true },
      h.exec,
    )
    expect(h.runAction).toHaveBeenNthCalledWith(
      2,
      'asc_apply',
      'stage',
      expect.objectContaining({ version: '1.2.3', buildId: 'b1', copyMetadataFrom: '1.1.0', confirm: true }),
      h.exec,
    )
  })

  it('rejects a .pkg dry run without version/build number before any step', async () => {
    const h = harness()
    registerJobTool(h.ctx, h.runtime, h.engine)
    await expect(
      toolOf(h.registered, 'asc_job').execute({ action: 'ship-testflight', file: 'App.pkg', dryRun: true }, h.exec),
    ).rejects.toThrow(/--version.*--build-number/)
    expect(h.runAction).not.toHaveBeenCalled()
  })
})
