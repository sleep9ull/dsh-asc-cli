/**
 * Shared execution runtime: session working directory, timeout selection,
 * argument re-validation at the execution boundary, and result formatting.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AuditFn } from './audit.js'
import type { Config } from './config.js'
import { resolveAscBinary } from './control/binary.js'
import type { VersionNotices } from './control/version-notice.js'
import { classifyArgv, isFileWriteArgv, normalizeArgv, writesReportFile } from './classify.js'
import { execAsc, globalFlags, type AscExecOutcome, type SpawnFn } from './exec.js'
import { formatResult, type AscToolResult } from './format.js'
import { specFor, type ToolArgs } from './registry.js'

/** Everything a tool body needs. */
export interface AscRuntime {
  readonly ctx: Context
  readonly config: Config
  readonly spawn: SpawnFn
  versionNotices?: VersionNotices
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

  /**
   * App Store Connect id to attach to an audit line.
   *
   * Typed actions pass `args.app`; the generic escape hatch can only supply it
   * through `--app`. The configured `defaultAppId` is the last resort, and an
   * unknown id stays absent rather than becoming a misleading empty string.
   */
  function auditAppId(explicit: unknown, argv: readonly string[] = []): string | undefined {
    if (typeof explicit === 'string' && explicit.length > 0) return explicit
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index] as string
      if (token === '--app') {
        const value = argv[index + 1]
        if (value !== undefined && value.length > 0) return value
      }
      if (token.startsWith('--app=')) {
        const value = token.slice('--app='.length)
        if (value.length > 0) return value
      }
    }
    return config.defaultAppId
  }

  function record(
    tool: string,
    action: string | undefined,
    kind: string,
    argv: readonly string[],
    cwd: string,
    confirm: boolean,
    result: AscToolResult,
    appId: string | undefined,
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
      ...(appId === undefined ? {} : { appId }),
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
      throw new Error(`asc.run refuses \`asc ${argv.join(' ')}\`: this command is not exposed by the plugin safety policy.`)
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
    if ((kind === 'local-write' || writesReportFile(argv)) && !options.confirm) {
      throw new Error(
        `asc.run refuses \`asc ${argv.join(' ')}\`: it writes local files and needs an explicit \`confirm: true\` after the user agrees.`,
      )
    }
    const timeoutMs = options.timeoutMs ?? (kind === 'read' ? config.timeoutMs : config.longTimeoutMs)
    // File-writing leaves must not receive `--output json`: several interpret the
    // value as an output file name (`analytics download` would create `./json`).
    const appendOutput = !argv.some((token) => /^--?(?:output|pretty)(?:=|$)/.test(token)) && !argv.includes('--')
    const root = normalizeArgv(argv).argv[0] ?? ''
    let attemptedOutput = appendOutput && !NO_OUTPUT_COMMANDS.has(root) && !isFileWriteArgv(argv)
    exec.signal.throwIfAborted()
    const snapshot = runtime.versionNotices?.execution(options.cwd ?? cwdFor(exec), root === 'version')
    const binary = snapshot === undefined ? {} : { binaryPath: snapshot.resolution.path }
    let outcome = await execAsc(
      config,
      {
        argv,
        cwd: options.cwd ?? cwdFor(exec),
        timeoutMs,
        maxBytes: config.maxOutputBytes,
        signal: exec.signal,
        appendOutput: attemptedOutput,
        ...binary,
      },
      spawnFn,
    )
    // Only replay a proven read when ASC specifically rejects our injected flag.
    // Usage failures can occur after local writes (including CI reports).
    if (kind === 'read' && shouldRetryWithoutOutput(attemptedOutput, outcome)) {
      attemptedOutput = false
      outcome = await execAsc(
        config,
        {
          argv,
          cwd: options.cwd ?? cwdFor(exec),
          timeoutMs,
          maxBytes: config.maxOutputBytes,
          signal: exec.signal,
          appendOutput: false,
          ...binary,
        },
        spawnFn,
      )
    }
    if (root === 'version') runtime.versionNotices?.observedVersion(snapshot, outcome.ok ? outcome.stdout : '')
    const formatted = formatResult(outcome, describeCommand(config, argv, attemptedOutput), {
      maxDataBytes: config.maxDataBytes,
    })
    const appId = auditAppId(undefined, argv)
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
      ...(appId === undefined ? {} : { appId }),
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
    exec.signal.throwIfAborted()
    const isVersion = tool === 'asc_setup' && action === 'version'
    const snapshot = runtime.versionNotices?.execution(cwd, isVersion)
    const outcome: AscExecOutcome = await execAsc(
      config,
      {
        argv,
        cwd,
        timeoutMs,
        maxBytes: config.maxOutputBytes,
        signal: exec.signal,
        appendOutput: spec.output !== false,
        ...(snapshot === undefined ? {} : { binaryPath: snapshot.resolution.path }),
      },
      spawnFn,
    )
    if (isVersion) runtime.versionNotices?.observedVersion(snapshot, outcome.ok ? outcome.stdout : '')
    const formatted = formatResult(outcome, describeCommand(config, argv, spec.output !== false), {
      maxDataBytes: config.maxDataBytes,
    })
    record(tool, action, spec.kind, argv, cwd, args.confirm === true, formatted, auditAppId(args.app))
    return formatted
  }

  const runtime: AscRuntime = { ctx, config, spawn: spawnFn, cwdFor, runAction, runArgv }
  return runtime
}

/** Roots that never accept `--output` (the generic path skips it up front). */
const NO_OUTPUT_COMMANDS = new Set(['version', 'install-skills', 'completion', 'docs', 'init', 'telemetry'])

/**
 * Whether to retry a failed generic invocation without `--output`.
 *
 * Exit 2 alone is insufficient: commands also use it for domain validation.
 * Require the exact unknown-output-flag parse diagnostic and no result. The
 * caller additionally restricts retries to reads without local artifacts.
 */
export function shouldRetryWithoutOutput(attempted: boolean, outcome: AscExecOutcome): boolean {
  return attempted && !outcome.ok && outcome.exitCode === 2 && !outcome.timedOut && !outcome.aborted &&
    outcome.stdout.trim() === '' && outcome.data === undefined &&
    /(?:unknown flag|flag provided but not defined)\s*:?\s*['"`]?--?output(?:['"`]?(?:\s|$))/i.test(outcome.stderr)
}

/** Human-readable command label shown to the model and the UI. */
export function describeCommand(config: Config, argv: readonly string[], withOutput = true): string {
  return [resolveAscBinary(config).path, ...globalFlags(config), ...argv, ...(withOutput ? ['--output', 'json'] : [])].join(' ')
}
