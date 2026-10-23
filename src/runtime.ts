/**
 * Shared execution runtime: session working directory, timeout selection,
 * argument re-validation at the execution boundary, and result formatting.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { classifyArgv } from './classify.js'
import { execAsc, globalFlags, type AscExecOutcome, type SpawnFn } from './exec.js'
import { formatResult, type AscToolResult } from './format.js'
import { specFor, type ToolArgs } from './registry.js'

/** Everything a tool body needs. */
export interface AscRuntime {
  readonly ctx: Context
  readonly config: Config
  readonly spawn: SpawnFn
  cwdFor(exec: ToolRunContext): string
  runAction(tool: string, action: string | undefined, args: ToolArgs, exec: ToolRunContext): Promise<AscToolResult>
  runArgv(argv: readonly string[], options: RunArgvOptions, exec: ToolRunContext): Promise<AscToolResult>
}

/** Options for the generic escape hatch. */
export interface RunArgvOptions {
  readonly confirm: boolean
  readonly timeoutMs?: number
  readonly cwd?: string
}

interface SessionLike {
  readonly session?: unknown
}

function defaultSpawn(ctx: Context): SpawnFn {
  return (spec) => ctx.subprocess.spawn(spec)
}

/** Build the shared runtime once per plugin instance. */
export function createRuntime(ctx: Context, config: Config, spawn?: SpawnFn): AscRuntime {
  const spawnFn = spawn ?? defaultSpawn(ctx)

  function cwdFor(exec: ToolRunContext): string {
    if (config.workdir) return config.workdir
    const agent = (exec as unknown as { agent?: SessionLike }).agent
    const service = ctx.reflect.get('workingDirectory') as
      | { get(session: unknown): string }
      | undefined
    if (agent?.session !== undefined && service !== undefined) {
      try {
        return service.get(agent.session)
      } catch {
        // Fall through to the process directory.
      }
    }
    return process.cwd()
  }

  async function runArgv(
    argv: readonly string[],
    options: RunArgvOptions,
    exec: ToolRunContext,
  ): Promise<AscToolResult> {
    const kind = classifyArgv(argv)
    if (kind === 'forbidden') {
      throw new Error(`asc_run refuses \`asc ${argv.join(' ')}\`: authentication and web-session commands are not exposed.`)
    }
    if ((kind === 'write' || kind === 'unknown') && config.mode === 'read-only') {
      throw new Error(
        `asc_run refuses \`asc ${argv.join(' ')}\`: it cannot be proven read-only and the plugin is in read-only mode.`,
      )
    }
    if ((kind === 'write' || kind === 'unknown') && !options.confirm) {
      throw new Error(
        `asc_run refuses \`asc ${argv.join(' ')}\`: it may mutate state and needs an explicit \`confirm: true\` after the user agrees.`,
      )
    }
    const timeoutMs = options.timeoutMs ?? (kind === 'read' ? config.timeoutMs : config.longTimeoutMs)
    const outcome = await execAsc(
      config,
      {
        argv,
        cwd: options.cwd ?? cwdFor(exec),
        timeoutMs,
        maxBytes: config.maxOutputBytes,
        signal: exec.signal,
        appendOutput: !['version', 'install-skills'].includes(argv[0] ?? ''),
      },
      spawnFn,
    )
    return formatResult(outcome, describeCommand(config, argv))
  }

  async function runAction(
    tool: string,
    action: string | undefined,
    args: ToolArgs,
    exec: ToolRunContext,
  ): Promise<AscToolResult> {
    const spec = specFor(tool, action)
    if (!spec) throw new Error(`asc: no registered action for ${action ? `${tool}.${action}` : tool}`)

    const cwd = cwdFor(exec)
    const argv = spec.build(args, { config, cwd })
    const requested = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
    const timeoutMs = requested ?? (spec.long ? config.longTimeoutMs : config.timeoutMs)
    const outcome: AscExecOutcome = await execAsc(
      config,
      {
        argv,
        cwd,
        timeoutMs,
        maxBytes: config.maxOutputBytes,
        signal: exec.signal,
        appendOutput: spec.output !== false,
      },
      spawnFn,
    )
    return formatResult(outcome, describeCommand(config, argv))
  }

  return { ctx, config, spawn: spawnFn, cwdFor, runAction, runArgv }
}

/** Human-readable command label shown to the model and the UI. */
export function describeCommand(config: Config, argv: readonly string[]): string {
  return [config.ascPath, ...globalFlags(config), ...argv, '--output', 'json'].join(' ')
}
