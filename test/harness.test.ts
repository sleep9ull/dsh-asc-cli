import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type PreToolDecision } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import * as AscPlugin from '../src/index.js'
import type { Config } from '../src/config.js'
import { makeConfig } from './helpers.js'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

function agentForCall(): Agent {
  const session = Session.create(SessionId('asc-harness-test'))
  session.append('turn/start', { turn: 1 })
  return { session } as Agent
}

async function harness(options: {
  config?: Partial<Config>
  approval?: ApprovalOutcome | 'missing'
  before?: (ctx: Context) => void
  version?: string
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(CommandRuntime)
  if (options.approval !== 'missing') await ctx.plugin(ApprovalService, { policy: 'ask' })
  const outcome = options.approval === 'missing' ? 'unavailable' : options.approval ?? 'allowed-once'
  const answer = vi.fn(async (_request: ApprovalRequest): Promise<ApprovalOutcome> => outcome)
  ctx.on('approval/request', answer)
  const spawn = vi.fn((_spec: SubprocessSpawnSpec): SubprocessHandle => {
    const read = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
    return {
      collected: { stdout: read(_spec.argv.includes('version') && options.version !== undefined ? options.version : '{"data":[]}'), stderr: read('') },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => undefined,
    } as unknown as SubprocessHandle
  })
  ctx.provide('subprocess', { spawn })
  options.before?.(ctx)
  const plugin = await ctx.plugin(AscPlugin, makeConfig({ ascPath: '/test/asc', defaultAppId: '123', ...options.config }))
  const agent = agentForCall()
  const call = (args: unknown, extra: { agent?: Agent; signal?: AbortSignal } = {}) => ctx.tools.execute({
    name: 'asc',
    callId: ToolCallId('same-call-id'),
    arguments: args,
    agent,
    signal: new AbortController().signal,
    ...extra,
  })
  return { ctx, plugin, agent, spawn, answer, call }
}

const unknown = { action: 'run', args: ['future-command'], confirm: true }
const write = { action: 'run', args: ['builds', 'upload', '--app', '123', '--ipa', 'App.ipa'], confirm: true }
const localWrite = { action: 'run', args: ['localizations', 'download', '--version', '1', '--path', './metadata'], confirm: true }

describe('real Harness tool pipeline', () => {
  it('registers five tools and dispatches a read into the subprocess seam', async () => {
    const h = await harness()
    expect(h.ctx.tools.schemas().map((tool) => tool.name).sort()).toEqual([
      'asc', 'asc_apply', 'asc_job', 'asc_plan', 'asc_setup',
    ])
    const result = await h.call({ action: 'apps-list' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ ok: true })
    expect(h.spawn).toHaveBeenCalledOnce()
    expect(h.answer).not.toHaveBeenCalled()
  })

  it('exposes six loadable skills and two commands, then removes them on unload', async () => {
    const h = await harness()
    const catalog = await h.ctx.skills.list()
    expect(catalog.map((skill) => skill.name)).toHaveLength(6)
    for (const skill of catalog) {
      expect((await h.ctx.skills.get(skill.name))?.content).toContain('asc')
    }
    expect(h.ctx.commands.list(h.agent).map((command) => command.name)).toEqual(['asc', 'asc-doctor'])
    const command = await h.ctx.commands.execute(h.agent, '/asc', [], new AbortController().signal)
    expect(command?.result.kind).toBe('success')
    if (command?.result.kind === 'success') expect(command.result.text).toContain('Jobs:')
    await h.plugin.dispose()
    expect(await h.ctx.skills.list()).toEqual([])
    expect(h.ctx.commands.list(h.agent)).toEqual([])
    expect(h.ctx.tools.schemas()).toEqual([])
  })

  it.each([unknown, write, localWrite])('dispatches only after a real approval grant: %j', async (args) => {
    const h = await harness({ config: { mode: 'write' } })
    const result = await h.call(args)
    expect(result.isError).toBe(false)
    expect(h.answer).toHaveBeenCalledOnce()
    expect(h.spawn).toHaveBeenCalledOnce()
    expect(h.answer.mock.calls[0]?.[0]).toMatchObject({
      agent: h.agent, toolName: 'asc', callId: 'same-call-id',
    })
  })

  it.each(['rejected', 'cancelled', 'unavailable', 'missing'] as const)('fails closed on approval %s', async (approval) => {
    const h = await harness({ approval })
    expect((await h.call(unknown)).isError).toBe(true)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('fails closed without an agent or with a pre-aborted caller', async () => {
    const h = await harness()
    expect((await h.call(unknown, { agent: undefined })).isError).toBe(true)
    expect((await h.call(unknown, { signal: AbortSignal.abort() })).isError).toBe(true)
    expect(h.answer).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it.each([unknown, write, localWrite])('a preceding allow cannot bypass policy: %j', async (args) => {
    const h = await harness({
      config: { mode: 'write' },
      before: (ctx) => ctx.on('tools/pre-execute', async () => ({ kind: 'allow' })),
    })
    expect((await h.call(args)).isError).toBe(true)
    expect(h.answer).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it.each([
    { action: 'run', args: ['auth', 'login'] },
    { ...write, confirm: false },
    unknown,
  ])('an outer allow cannot overwrite a denial or ask: %j', async (args) => {
    const h = await harness({
      config: { mode: 'write' }, approval: 'rejected',
      before: (ctx) => ctx.on('tools/pre-execute', async (_exec, next): Promise<PreToolDecision> => {
        await next()
        return { kind: 'allow' }
      }),
    })
    expect((await h.call(args)).isError).toBe(true)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('does not reuse a grant for another execution with the same call id', async () => {
    let bypass = false
    const h = await harness({ before: (ctx) => ctx.on('tools/pre-execute', async (_exec, next) => bypass ? { kind: 'allow' } : next()) })
    expect((await h.call(unknown)).isError).toBe(false)
    bypass = true
    expect((await h.call(unknown)).isError).toBe(true)
    expect(h.answer).toHaveBeenCalledOnce()
    expect(h.spawn).toHaveBeenCalledOnce()
  })

  it('isolates concurrent approvals even when arguments and call ids match', async () => {
    let release!: (outcome: ApprovalOutcome) => void
    let asked!: () => void
    const pending = new Promise<ApprovalOutcome>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { asked = resolve })
    const h = await harness()
    h.answer.mockImplementationOnce(async () => { asked(); return pending }).mockResolvedValueOnce('rejected')
    const allowed = h.call(unknown)
    await started
    expect((await h.call(unknown)).isError).toBe(true)
    expect(h.spawn).not.toHaveBeenCalled()
    release('allowed-once')
    expect((await allowed).isError).toBe(false)
    expect(h.spawn).toHaveBeenCalledOnce()
  })

  it('rejects arguments replaced after their approval', async () => {
    const h = await harness({ before: (ctx) => ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      ;(exec as { arguments: unknown }).arguments = { ...unknown, args: ['different-future-command'] }
      return decision
    }) })
    expect((await h.call(unknown)).isError).toBe(true)
    expect(h.answer).toHaveBeenCalledOnce()
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('does not approve a caller cancelled while awaiting a human', async () => {
    const controller = new AbortController()
    const h = await harness()
    h.answer.mockImplementationOnce(async () => {
      controller.abort()
      return 'allowed-once'
    })
    expect((await h.call(unknown, { signal: controller.signal })).isError).toBe(true)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('keeps read-only denials and invalid registered combinations ahead of approval', async () => {
    const h = await harness()
    expect((await h.call(write)).isError).toBe(true)
    const invalid = await h.ctx.tools.execute({
      name: 'asc_apply', callId: ToolCallId('invalid'), agent: h.agent,
      arguments: { action: 'upload', file: 'App.ipa', dryRun: true, wait: true, confirm: true },
      signal: new AbortController().signal,
    })
    expect(invalid.isError).toBe(true)
    expect(invalid.error?.info?.code).toBe('ASC_INVALID_ARGUMENTS')
    expect(h.answer).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['asc', { action: 'apps-list' }],
    ['asc_plan', { action: 'status' }],
    ['asc_apply', { action: 'metadata-init', dir: '/fixture/metadata', confirm: true }],
    ['asc_job', { action: 'release-check' }],
    ['asc_setup', { action: 'version' }],
  ])('renders a version advisory through the real %s pipeline', async (name, args) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ tag_name: '7.0.0' })))
    vi.stubGlobal('fetch', fetch)
    const h = await harness({ config: { ascPath: process.execPath, checkUpdates: true }, version: '6.2.0 (commit: fixture)' })
    const invoke = (agent = h.agent) => h.ctx.tools.execute({
      name: name as string, arguments: args, callId: ToolCallId('notice'), agent,
      signal: new AbortController().signal,
    })
    const first = await invoke()
    expect(first.isError).toBe(false)
    expect(first.value).toMatchObject({ ok: true, versionNotice: { code: 'upgrade-required', installedVersion: '6.2.0' } })
    expect(first.content.some((part) => part.type === 'text' && part.text.includes('Verified recommendation: 6.3.0'))).toBe(true)
    expect((await invoke()).value).not.toHaveProperty('versionNotice')
    expect((await invoke(agentForCall())).value).toHaveProperty('versionNotice')
    expect(fetch).toHaveBeenCalledOnce()
    const versionCalls = h.spawn.mock.calls.filter(([spec]) => spec.argv.includes('version'))
    expect(versionCalls).toHaveLength(name === 'asc_setup' ? 3 : 1)
  })

  it('does not start automatic checks before approval or argument validation', async () => {
    const fetch = vi.fn(async () => { throw new Error('unexpected network') })
    vi.stubGlobal('fetch', fetch)
    const h = await harness({ config: { ascPath: process.execPath, checkUpdates: true }, approval: 'rejected' })
    expect((await h.call(unknown)).isError).toBe(true)
    expect((await h.call({ action: 'run', args: ['auth', 'login'] })).isError).toBe(true)
    expect((await h.call({ action: 'apps-list' }, { signal: AbortSignal.abort() })).isError).toBe(true)
    expect(h.spawn).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps the start card lightweight and shows the automatic version notice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: '7.0.0' }))))
    const h = await harness({ config: { ascPath: process.execPath, checkUpdates: true }, version: '6.2.0' })
    const card = await h.ctx.commands.execute(h.agent, '/asc', [], new AbortController().signal)
    expect(card?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('Verified recommendation: 6.3.0') })
    expect(h.spawn).toHaveBeenCalledOnce()
    expect(h.spawn.mock.calls[0]?.[0].argv).toContain('version')
  })

  it('keeps explicit approval exemptions and confirm requirements', async () => {
    const h = await harness({ config: { mode: 'write', requireApproval: false } })
    expect((await h.call(write)).isError).toBe(false)
    expect((await h.call({ ...write, confirm: false })).isError).toBe(true)
    expect(h.answer).not.toHaveBeenCalled()
    expect(h.spawn).toHaveBeenCalledOnce()
  })
})
