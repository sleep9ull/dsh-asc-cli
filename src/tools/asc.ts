/**
 * `asc` — read-only inventory, discovery and the escape hatch.
 *
 * Read actions are typed (`apps-list`, `builds-list`, ...) so the common cases
 * cost no argv invention. `discover` wraps `asc search`; `run` forwards any
 * argv and is classified by the pre-execution policy (writes need `confirm`
 * and approval, forbidden commands are refused).
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderResult, type AscToolResult } from '../format.js'
import type { AscRuntime } from '../runtime.js'
import type { ToolArgs } from '../registry.js'
import { RESULT_SCHEMA } from './common.js'

const READ_ACTIONS = [
  'apps-list',
  'apps-view',
  'builds-list',
  'builds-next-number',
  'testflight-feedback',
  'testflight-crashes',
  'testflight-groups',
  'reviews-list',
  'metadata-validate',
] as const

const DESCRIPTION = `Read App Store Connect data through asc, or run any asc command as a last resort.

Actions:
- apps-list / apps-view: find an app id or inspect one app.
- builds-list / builds-next-number: build inventory and the next safe build number.
- testflight-feedback / testflight-crashes / testflight-groups: TestFlight signal and beta groups.
- reviews-list: customer reviews (newest first with sort: "-createdDate").
- metadata-validate: validate a canonical metadata directory offline.
- discover: search asc's own command tree (local, no network) when you are unsure which command to use.
- run: any asc argv (no shell). Read-only commands run directly. Mutations and local writes need confirm: true and host approval (local writes such as \`download\`/\`export\` in both modes; mutations only in write mode). Authentication and web-session commands are always refused. Known actions and jobs validate their arguments before confirm/approval, so illegal combinations (e.g. upload dryRun+wait, publish without ipa/pkg, stage with zero or two metadata sources) are rejected up front instead of failing inside asc.

Prefer asc_job for whole workflows (release-check, ship-testflight, stage-release, triage-feedback, compliance-sweep) and asc_apply for mutations. Values are passed literally: a leading @ is escaped so asc's @env:/@file: expansion cannot read local files unless allowValueExpansion is enabled.`

export function registerAscTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineTool({
    name: 'asc',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        enum: ['run', 'discover', ...READ_ACTIONS],
        required: true,
        description: 'Which read operation to run, or `run`/`discover` for the generic paths.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'For run: argv tail after `asc`, e.g. ["builds","list","--app","123"]. No shell quoting.',
      },
      query: { type: 'string', description: 'For discover: keywords or a task description.' },
      app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
      name: { type: 'string', description: 'For apps-list: filter by app name(s), comma-separated.' },
      bundleId: { type: 'string', description: 'For apps-list: filter by bundle id(s), comma-separated.' },
      sort: { type: 'string', description: 'Sort order, e.g. "-createdDate" or "name".' },
      version: { type: 'string', description: 'Marketing version filter (CFBundleShortVersionString).' },
      buildNumber: { type: 'string', description: 'Build number filter (CFBundleVersion).' },
      platform: {
        type: 'string',
        enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
        description: 'Platform filter.',
      },
      excludeExpired: { type: 'boolean', description: 'For builds-list / builds-next-number: exclude expired builds.' },
      paginate: { type: 'boolean', description: 'Fetch every page (can be large; prefer filters).' },
      internal: { type: 'boolean', description: 'For testflight-groups: internal groups only.' },
      external: { type: 'boolean', description: 'For testflight-groups: external groups only.' },
      dir: { type: 'string', description: 'For metadata-validate: metadata directory.' },
      limit: { type: 'integer', description: 'Page size (default 20).' },
      timeoutMs: { type: 'integer', description: 'For run: optional timeout override in milliseconds.' },
      cwd: { type: 'string', description: 'For run: optional working directory.' },
      confirm: {
        type: 'boolean',
        description: 'For run: explicit confirmation when the command may mutate state. Only after the user agrees.',
      },
    },
    timeoutMs: runtime.config.longTimeoutMs + 30_000,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => renderResult(value as unknown as AscToolResult),
      presentationMeta: (_args, value) => {
        const result = value as unknown as AscToolResult
        return { ok: result.ok, exitCode: result.exitCode }
      },
    },
    presentCall: (args) => {
      const action = (args as { action?: unknown }).action
      const suffix = typeof action === 'string' ? ` ${action}` : ''
      return { card: 'terminal', title: `asc${suffix}`, description: 'App Store Connect CLI' }
    },
    presentResult: (_args, result) => {
      const meta = (result.meta ?? {}) as { ok?: unknown; exitCode?: unknown }
      const ok = typeof meta.ok === 'boolean' ? meta.ok : !result.isError
      const exitCode = ok ? 0 : typeof meta.exitCode === 'number' ? meta.exitCode : 1
      const output = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
      return { card: 'terminal', title: 'asc', output, exitCode }
    },
    async execute(args, exec: ToolRunContext) {
      const action = typeof args.action === 'string' ? args.action : ''
      if (action === 'run') {
        const argv = (args.args ?? []).filter((item): item is string => typeof item === 'string' && item.length > 0)
        if (argv.length === 0) throw new Error('asc: `args` must contain at least one token for action `run`')
        return (await runtime.runArgv(
          argv,
          {
            confirm: args.confirm === true,
            ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          },
          exec,
        )) as unknown as JsonValue
      }
      if (action === 'discover') {
        const query = typeof args.query === 'string' ? args.query : ''
        if (query.length === 0) throw new Error('asc: `query` is required for action `discover`')
        const argv = ['search', '--limit', String(args.limit ?? 10), query]
        return (await runtime.runArgv(argv, { confirm: false }, exec)) as unknown as JsonValue
      }
      return (await runtime.runAction('asc', action, args as ToolArgs, exec)) as unknown as JsonValue
    },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
