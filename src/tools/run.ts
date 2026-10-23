/**
 * `asc_run` — the generic escape hatch.
 *
 * This is what keeps the plugin useful when upstream adds commands: new
 * commands work immediately, classified conservatively, without a plugin
 * release. The typed tools remain the fast path.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { classifyArgv, kindLabel } from '../classify.js'
import { renderResult, type AscToolResult } from '../format.js'
import type { AscRuntime } from '../runtime.js'
import { RESULT_SCHEMA } from './common.js'

const DESCRIPTION = `Run any \`asc\` command as an argument array (no shell). This is the escape hatch for commands the typed tools do not cover.

Safety: the plugin classifies the command. Read-only commands run directly. Commands that may mutate App Store Connect require \`confirm: true\` and (in write mode) a host approval; in read-only mode they are refused. Authentication commands (auth login/logout, web auth) and web-session commands are always refused.

Use asc_search first to find the right command. Pass flags exactly as asc documents them, including \`--confirm\` where asc itself requires it for the mutation.`

export function registerRunTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineTool({
    name: 'asc_run',
    description: DESCRIPTION,
    parameters: {
      args: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'argv tail after `asc`, e.g. ["builds","list","--app","123456789"]. No shell quoting.',
      },
      confirm: {
        type: 'boolean',
        description: 'Explicit confirmation for commands that mutate App Store Connect. Only set after the user agrees.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Optional timeout override in milliseconds.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory; defaults to the session working directory.',
      },
    },
    timeoutMs: runtime.config.longTimeoutMs + 30_000,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => renderResult(value as unknown as AscToolResult),
    },
    presentCall: (args) => ({
      card: 'terminal',
      title: `asc ${args.args.join(' ')}`,
      description: 'App Store Connect CLI',
    }),
    presentResult: (_args, result) => {
      const output = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
      return { card: 'terminal', title: 'asc_run', output, exitCode: result.isError ? 1 : 0 }
    },
    async execute(args, exec: ToolRunContext) {
      const argv = args.args.filter((item) => typeof item === 'string' && item.length > 0)
      if (argv.length === 0) throw new Error('asc_run: `args` must contain at least one token')
      const kind = classifyArgv(argv)
      if (kind === 'forbidden') {
        throw new Error(
          `asc_run refuses \`asc ${argv.join(' ')}\`: authentication and web-session commands are not exposed by this plugin.`,
        )
      }
      const mutation = kind === 'write' || kind === 'unknown'
      if (mutation && runtime.config.mode === 'read-only') {
        throw new Error(
          `asc_run refuses \`asc ${argv.join(' ')}\`: it is a ${kindLabel(kind)} and the plugin is in read-only mode.`,
        )
      }
      const needsConfirm = mutation || kind === 'local-write'
      if (needsConfirm && args.confirm !== true) {
        throw new Error(
          `asc_run refuses \`asc ${argv.join(' ')}\`: it may mutate state or write local files; pass \`confirm: true\` only after the user agrees.`,
        )
      }
      const result = await runtime.runArgv(
        argv,
        {
          confirm: args.confirm === true,
          ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        },
        exec,
      )
      return result as unknown as JsonValue
    },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
