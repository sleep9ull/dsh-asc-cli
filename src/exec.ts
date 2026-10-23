/**
 * The only place the plugin starts an `asc` child process.
 *
 * Every invocation:
 *  - passes argv as an array (never a shell string),
 *  - forces JSON output and, in read-only mode, ASC's own `--read-only`,
 *  - caps collected output and lets the subprocess seam keep a spill file,
 *  - forwards cancellation and enforces a deadline,
 *  - strips credential-shaped text from diagnostics.
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './config.js'

/** Minimal spawn surface, injectable for tests. */
export type SpawnFn = (spec: SubprocessSpawnSpec) => SubprocessHandle

/** One prepared invocation. */
export interface AscExecRequest {
  /** argv tail after the executable and global flags. */
  readonly argv: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly maxBytes: number
  readonly signal?: AbortSignal | undefined
  /** Append `--output json`; set false for commands that reject the flag. */
  readonly appendOutput?: boolean
}

/** Structured outcome of one `asc` invocation. */
export interface AscExecOutcome {
  readonly ok: boolean
  readonly exitCode: number
  readonly exitSignal: string | null
  readonly durationMs: number
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  readonly spillPath?: string
  readonly data?: unknown
  readonly parseFailed: boolean
}

/** Global flags that precede the subcommand. */
export function globalFlags(config: Config): string[] {
  const flags: string[] = []
  if (config.profile) flags.push('--profile', config.profile)
  if (config.mode === 'read-only') flags.push('--read-only')
  return flags
}

/** Environment entries layered onto the scrubbed parent environment. */
export function childEnv(config: Config): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...config.env }
  if (config.telemetryDisabled) env.ASC_TELEMETRY_DISABLED = '1'
  if (config.bypassKeychain) env.ASC_BYPASS_KEYCHAIN = '1'
  if (config.mode === 'read-only') env.ASC_READ_ONLY = '1'
  return env
}

/** Remove credential-shaped material from diagnostics. */
export function redact(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted token]')
    .replace(/((?:password|secret|api[_-]?key|private[_-]?key)\s*[=:]\s*)\S+/gi, '$1[redacted]')
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Build the fully explicit spawn spec for the subprocess seam. */
export function buildSpawnSpec(config: Config, request: AscExecRequest, signal: AbortSignal): SubprocessSpawnSpec {
  const output = request.appendOutput === false ? [] : ['--output', 'json']
  const argv = [config.ascPath, ...globalFlags(config), ...request.argv, ...output]
  return {
    argv,
    cwd: request.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: Math.min(Math.max(1024, request.maxBytes), 8 * 1024 * 1024), spill: { maxBytes: 16 * 1024 * 1024 } },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 2_000,
    signal,
    env: childEnv(config),
  }
}

function parseJson(stdout: string): { data?: unknown; parseFailed: boolean } {
  const text = stdout.trim()
  if (text.length === 0) return { parseFailed: false }
  if (!text.startsWith('{') && !text.startsWith('[')) return { parseFailed: true }
  try {
    return { data: JSON.parse(text) as unknown, parseFailed: false }
  } catch {
    return { parseFailed: true }
  }
}

/**
 * Run one `asc` invocation to completion.
 * @param spawn - subprocess seam (or a test double).
 */
export async function execAsc(
  config: Config,
  request: AscExecRequest,
  spawn: SpawnFn,
): Promise<AscExecOutcome> {
  const started = Date.now()
  const timeoutController = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, Math.min(Math.max(1, request.timeoutMs), MAX_TIMER_DELAY_MS))

  const signals: AbortSignal[] = [timeoutController.signal]
  if (request.signal) signals.push(request.signal)
  const combined = AbortSignal.any(signals)

  let handle: SubprocessHandle | undefined
  try {
    handle = spawn(buildSpawnSpec(config, request, combined))
    const outcome = await handle.done
    const stdoutRead = handle.collected.stdout?.readFrom(0)
    const stderrRead = handle.collected.stderr?.readFrom(0)
    const stdout = stdoutRead?.text ?? ''
    const stderr = stderrRead?.text ?? ''
    const parsed = parseJson(stdout)
    const exitCode = outcome.exitCode ?? -1
    return {
      ok: exitCode === 0 && !timedOut && !combined.aborted,
      exitCode,
      exitSignal: outcome.signal,
      durationMs: Date.now() - started,
      timedOut,
      aborted: combined.aborted && !timedOut,
      stdout,
      stderr: redact(stderr),
      truncated: stdoutRead?.lossy === true,
      ...(stdoutRead?.spillPath === undefined ? {} : { spillPath: stdoutRead.spillPath }),
      ...(parsed.data === undefined ? {} : { data: parsed.data }),
      parseFailed: parsed.parseFailed,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      exitCode: -1,
      exitSignal: null,
      durationMs: Date.now() - started,
      timedOut,
      aborted: combined.aborted && !timedOut,
      stdout: '',
      stderr: redact(message),
      truncated: false,
      parseFailed: false,
    }
  } finally {
    clearTimeout(timer)
    if (timedOut) handle?.terminate()
  }
}
