/**
 * Shared execution runtime: session working directory, timeout selection,
 * argument re-validation at the execution boundary, and result formatting.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AuditFn } from './audit.js'
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
export function createRuntime(ctx: Context, config: Config, spawn?: SpawnFn, audit: AuditFn = () => undefined): AscRuntime {
  const spawnFn = spawn ?? defaultSpawn(ctx)

  function record(
    tool: string,
    action: string | undefined,
    kind: string,
    argv: readonly string[],
    cwd: string,
    confirm: boolean,
    result: AscToolResult,
  ): void {
    audit({
      ts: new Date().toISOString(),
      tool,
      ...(action === undefined ? {} : { action }),
      kind,
      argv,
      cwd,
      mode: config.mode,
      confirm,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      ...(result.errorClass === undefined ? {} : { errorClass: result.errorClass }),
    })
  }

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
      throw new Error(`asc.run refuses \`asc ${argv.join(' ')}\`: authentication and web-session commands are not exposed.`)
    }
    if (kind === 'write' && config.mode === 'read-only') {
      throw new Error(
        `asc.run refuses \`asc ${argv.join(' ')}\`: it mutates App Store Connect and the plugin is in read-only mode.`,
      )
    }
    if (kind === 'unknown' && config.mode === 'read-only' && config.unknownCommands === 'deny') {
      throw new Error(
        `asc.run refuses \`asc ${argv.join(' ')}\`: it cannot be proven read-only and \`unknownCommands\` is \`deny\`.`,
      )
    }
    if ((kind === 'write' || kind === 'unknown') && config.mode === 'write' && !options.confirm) {
      throw new Error(
        `asc.run refuses \`asc ${argv.join(' ')}\`: it may mutate state and needs an explicit \`confirm: true\` after the user agrees.`,
      )
    }
    if (kind === 'local-write' && !options.confirm) {
      throw new Error(
        `asc.run refuses \`asc ${argv.join(' ')}\`: it writes local files and needs an explicit \`confirm: true\` after the user agrees.`,
      )
    }
    const timeoutMs = options.timeoutMs ?? (kind === 'read' ? config.timeoutMs : config.longTimeoutMs)
    const appendOutput = !argv.includes('--output') && !argv.includes('--pretty')
    const withOutput = appendOutput && !NO_OUTPUT_COMMANDS.has(argv[0] ?? '')
    let outcome = await execAsc(
      config,
      {
        argv,
        cwd: options.cwd ?? cwdFor(exec),
        timeoutMs,
        maxBytes: config.maxOutputBytes,
        signal: exec.signal,
        appendOutput: withOutput,
      },
      spawnFn,
    )
    // Some leaf commands reject `--output`; `exit 2` means the flags were parsed
    // before any work started, so a retry without it cannot duplicate a mutation.
    if (shouldRetryWithoutOutput(withOutput, outcome)) {
      outcome = await execAsc(
        config,
        {
          argv,
          cwd: options.cwd ?? cwdFor(exec),
          timeoutMs,
          maxBytes: config.maxOutputBytes,
          signal: exec.signal,
          appendOutput: false,
        },
        spawnFn,
      )
    }
    const formatted = formatResult(outcome, describeCommand(config, argv, withOutput), {
      maxDataBytes: config.maxDataBytes,
    })
    audit({
      ts: new Date().toISOString(),
      tool: 'asc',
      action: 'run',
      kind,
      argv,
      cwd: options.cwd ?? cwdFor(exec),
      mode: config.mode,
      confirm: options.confirm,
      ok: formatted.ok,
      exitCode: formatted.exitCode,
      durationMs: formatted.durationMs,
      ...(formatted.errorClass === undefined ? {} : { errorClass: formatted.errorClass }),
    })
    return formatted
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
    const formatted = formatResult(outcome, describeCommand(config, argv, spec.output !== false), {
      maxDataBytes: config.maxDataBytes,
    })
    record(tool, action, spec.kind, argv, cwd, args.confirm === true, formatted)
    return formatted
  }

  return { ctx, config, spawn: spawnFn, cwdFor, runAction, runArgv }
}

/** Roots that never accept `--output` (the generic path skips it up front). */
const NO_OUTPUT_COMMANDS = new Set(['version', 'install-skills', 'completion', 'docs', 'init', 'telemetry'])

/**
 * Whether to retry a failed generic invocation without `--output`.
 *
 * An `exit 2` from `asc` happens while parsing flags, before any request or
 * local write, so retrying without the flag cannot duplicate a mutation. This
 * covers leaf commands that reject `--output` (and whose message may not name
 * the flag).
 */
export function shouldRetryWithoutOutput(attempted: boolean, outcome: AscExecOutcome): boolean {
  return attempted && !outcome.ok && outcome.exitCode === 2 && !outcome.timedOut && !outcome.aborted
}

/** Human-readable command label shown to the model and the UI. */
export function describeCommand(config: Config, argv: readonly string[], withOutput = true): string {
  return [config.ascPath, ...globalFlags(config), ...argv, ...(withOutput ? ['--output', 'json'] : [])].join(' ')
}
