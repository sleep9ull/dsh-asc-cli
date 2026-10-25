/**
 * Model-facing formatting: compact summaries, error classification and
 * actionable hints. Keeping `asc`'s (often large) JSON out of the context is
 * a product requirement, not a cosmetic one.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { redact, type AscExecOutcome } from './exec.js'

/** Canonical tool value; also the `output.schema` contract. */
export type AscToolResult = {
  ok: boolean
  exitCode: number
  command: string
  durationMs: number
  summary: string
  errorClass?: string
  hint?: string
  data?: JsonValue
  /** Present when `data` was dropped because it exceeded `maxDataBytes`. */
  dataOmitted?: boolean
  /** Byte size of the JSON that was dropped from `data`. */
  dataBytes?: number
  text?: string
  stderrTail?: string
  truncated?: boolean
  spillPath?: string
  timedOut?: boolean
  aborted?: boolean
}

/** Error taxonomy surfaced to the model and the UI. */
export type AscErrorClass =
  | 'auth'
  | 'state-conflict'
  | 'rate-limit'
  | 'usage'
  | 'missing-binary'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'parse'
  | 'unknown'

const HINTS: Record<AscErrorClass, string> = {
  auth: 'Credentials are missing or lack permission. Run `asc auth status --validate`, then fix the key/profile (permissions are managed in App Store Connect → Users and Access).',
  'state-conflict': 'The resource is not in a state that allows this operation. Inspect it first (for example `asc status --app <APP_ID>` or `asc validate --app <APP_ID>`), then retry.',
  'rate-limit': 'Apple rate-limited the request. Wait a little and retry; avoid `--paginate` on very large collections.',
  usage: 'The command or flags were rejected by `asc`. Check `asc <command> --help` and retry with valid flags.',
  'missing-binary': 'The `asc` executable was not found. Install it (`brew install asc`) or set `ascPath` in the plugin config.',
  network: 'Network or Apple service failure. Check `asc system-status`, then retry.',
  timeout: 'The command exceeded its deadline. Re-run with a larger `timeoutMs` (or `longTimeoutMs` for uploads/waits), or narrow the request.',
  cancelled: 'The command was cancelled before it completed.',
  parse: '`asc` returned non-JSON output. Re-run with `--output json` (the plugin does this by default) and check the raw text.',
  unknown: 'The command failed. Inspect `stderrTail` for the underlying error.',
}

/** Pick one error class from the process facts and diagnostics. */
export function classifyError(outcome: AscExecOutcome): AscErrorClass | undefined {
  if (outcome.ok) return undefined
  if (outcome.timedOut) return 'timeout'
  if (outcome.aborted) return 'cancelled'
  const stderr = outcome.stderr.toLowerCase()
  if (outcome.exitCode === 2) return 'usage'
  if (stderr.includes('missing authentication') || stderr.includes("run 'asc auth login'")) return 'auth'
  if (
    outcome.exitCode === -1 &&
    (stderr.includes('enoent') || stderr.includes('not found') || stderr.includes('no such file'))
  ) {
    return 'missing-binary'
  }
  if (/\b(401|403)\b/.test(outcome.stderr) || stderr.includes('unauthorized') || stderr.includes('forbidden')) {
    return 'auth'
  }
  if (/\b409\b/.test(outcome.stderr) || stderr.includes('resource state is invalid')) return 'state-conflict'
  if (/\b429\b/.test(outcome.stderr) || stderr.includes('rate limit') || stderr.includes('too many requests')) {
    return 'rate-limit'
  }
  if (/\b5\d\d\b/.test(outcome.stderr) || stderr.includes('network') || stderr.includes('connection')) return 'network'
  if (
    stderr.includes('unknown command') ||
    stderr.includes('unknown flag') ||
    stderr.includes('flag provided but not defined') ||
    stderr.includes('required flag') ||
    stderr.includes('invalid argument') ||
    stderr.includes('usage:')
  ) {
    return 'usage'
  }
  if (outcome.parseFailed && outcome.stdout.trim().length > 0) return 'parse'
  return 'unknown'
}

function attributeSummary(item: unknown): string {
  if (item === null || typeof item !== 'object') return String(item)
  const record = item as Record<string, unknown>
  const attributes =
    record.attributes !== null && typeof record.attributes === 'object'
      ? (record.attributes as Record<string, unknown>)
      : record
  const parts: string[] = []
  const id = typeof record.id === 'string' ? record.id : undefined
  if (id) parts.push(`id=${id}`)
  for (const key of ['name', 'bundleId', 'sku', 'version', 'buildNumber', 'processingState', 'state', 'createdDate']) {
    const value = attributes[key]
    if (typeof value === 'string' || typeof value === 'number') parts.push(`${key}=${String(value)}`)
  }
  if (parts.length === 0) return JSON.stringify(item).slice(0, 160)
  return parts.join(' ')
}

function compactJson(value: unknown, limit = 1_200): string {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * `asc validate` returns `{summary:{errors,warnings,infos,blocking},
 * remediation:{totalActionable,steps[]}, checks[]}`. Agents need the ordered
 * remediation steps, not a truncated JSON blob.
 */
function readinessSummary(record: Record<string, unknown>): string | undefined {
  const summary = record.summary
  if (!isRecord(summary)) return undefined
  const blocking = numberField(summary, 'blocking')
  const errors = numberField(summary, 'errors')
  const warnings = numberField(summary, 'warnings')
  if (blocking === undefined && errors === undefined && warnings === undefined) return undefined
  const parts: string[] = []
  if (blocking !== undefined) parts.push(`blocking=${blocking}`)
  if (errors !== undefined) parts.push(`errors=${errors}`)
  if (warnings !== undefined) parts.push(`warnings=${warnings}`)
  const remediation = record.remediation
  const steps = isRecord(remediation) && Array.isArray(remediation.steps) ? remediation.steps : []
  if (steps.length === 0) return parts.join(' ')
  const rows = steps.slice(0, 6).map((step, index) => {
    const item = isRecord(step) ? step : {}
    const severity = stringField(item, 'severity')
    const message = stringField(item, 'message') ?? stringField(item, 'title') ?? stringField(item, 'action') ?? ''
    return `${index + 1}. ${severity === undefined ? '' : `[${severity}] `}${message}`
  })
  return `${parts.join(' ')}\n${rows.join('\n')}`
}

/**
 * `asc status` keeps its headline facts under `summary`
 * (`health/nextAction/blockers/nextCommands`).
 */
function dashboardSummary(record: Record<string, unknown>): string | undefined {
  const summary = record.summary
  if (!isRecord(summary)) return undefined
  const health = stringField(summary, 'health')
  const nextAction = stringField(summary, 'nextAction')
  if (health === undefined && nextAction === undefined) return undefined
  const lines: string[] = []
  if (health !== undefined) lines.push(`health=${health}`)
  if (nextAction !== undefined) lines.push(`next=${nextAction}`)
  const blockers = Array.isArray(summary.blockers) ? summary.blockers : []
  for (const blocker of blockers.slice(0, 4)) {
    const item = isRecord(blocker) ? blocker : {}
    lines.push(`- blocker: ${stringField(item, 'message') ?? stringField(item, 'title') ?? compactJson(blocker, 120)}`)
  }
  const nextCommands = Array.isArray(summary.nextCommands) ? summary.nextCommands : []
  if (nextCommands.length > 0) {
    lines.push(`nextCommands:\n${nextCommands.slice(0, 5).map((command) => `- ${String(command)}`).join('\n')}`)
  }
  return lines.join('\n')
}

/** `asc metadata apply` reports flat counters. */
function metadataSummary(record: Record<string, unknown>): string | undefined {
  const total = numberField(record, 'total')
  const succeeded = numberField(record, 'succeeded')
  const failed = numberField(record, 'failed')
  if (total === undefined && succeeded === undefined && failed === undefined) return undefined
  const parts: string[] = []
  if (total !== undefined) parts.push(`total=${total}`)
  if (succeeded !== undefined) parts.push(`succeeded=${succeeded}`)
  if (failed !== undefined) parts.push(`failed=${failed}`)
  const applied = numberField(record, 'applied')
  if (applied !== undefined) parts.push(`applied=${applied}`)
  for (const key of ['adds', 'updates', 'deletes']) {
    const value = record[key]
    if (Array.isArray(value)) parts.push(`${key}=${value.length}`)
  }
  return parts.join(' ')
}

/** Summarize `asc` JSON for a human and for a token budget. */
export function summarize(data: unknown, limit = 8): string {
  if (data === null || data === undefined) return 'no JSON payload'
  if (Array.isArray(data)) {
    const rows = data.slice(0, limit).map(attributeSummary)
    return `${data.length} item(s)\n${rows.map((row) => `- ${row}`).join('\n')}`
  }
  if (typeof data !== 'object') return String(data)
  const record = data as Record<string, unknown>

  const errors = record.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const rows = errors.slice(0, limit).map((error) => {
      if (error === null || typeof error !== 'object') return String(error)
      const item = error as Record<string, unknown>
      const title = typeof item.title === 'string' ? item.title : 'error'
      const detail = typeof item.detail === 'string' ? item.detail : ''
      return detail ? `${title}: ${detail}` : title
    })
    return `API errors (${errors.length}):\n${rows.map((row) => `- ${row}`).join('\n')}`
  }

  const collection = record.data
  if (Array.isArray(collection)) {
    const rows = collection.slice(0, limit).map(attributeSummary)
    return `${collection.length} item(s)\n${rows.map((row) => `- ${row}`).join('\n')}`
  }

  if (Array.isArray(record.results)) {
    const rows = record.results.slice(0, limit).map((entry) => {
      if (entry === null || typeof entry !== 'object') return String(entry)
      const item = entry as Record<string, unknown>
      const command = typeof item.command === 'string' ? item.command : '?'
      const detail = typeof item.summary === 'string' ? ` — ${item.summary}` : ''
      return `${command}${detail}`
    })
    return `${record.results.length} result(s)\n${rows.map((row) => `- ${row}`).join('\n')}`
  }

  if (Array.isArray(record.credentials)) {
    const storage = typeof record.storageBackend === 'string' ? record.storageBackend : 'unknown'
    const env = record.environmentCredentialsProvided === true ? ', env credentials provided' : ''
    return `${record.credentials.length} stored credential(s) in ${storage}${env}\n${compactJson(data, 800)}`
  }

  const projected = readinessSummary(record) ?? dashboardSummary(record) ?? metadataSummary(record)
  if (projected !== undefined) return projected

  const summaryParts: string[] = []
  for (const key of [
    'state',
    'ready',
    'status',
    'outcome',
    'reached',
    'version',
    'buildNumber',
    'nextBuildNumber',
    'processingState',
    'health',
    'nextAction',
  ]) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      summaryParts.push(`${key}=${String(value)}`)
    }
  }
  for (const key of ['blockers', 'warnings', 'checks', 'nextCommands']) {
    const value = record[key]
    if (Array.isArray(value)) summaryParts.push(`${key}=${value.length}`)
  }
  if (summaryParts.length > 0) {
    return `${summaryParts.join(' ')}\n${compactJson(data, 1_400)}`
  }
  if (record.data !== null && typeof record.data === 'object') {
    return compactJson(record.data, 1_400)
  }
  return compactJson(data)
}

/** Redact and cap stderr for the model. */
export function stderrTail(stderr: string, limit = 2_000): string | undefined {
  const text = redact(stderr).trim()
  if (text.length === 0) return undefined
  return text.length > limit ? `…${text.slice(-limit)}` : text
}

/** Build the canonical result value for one invocation. */
export function formatResult(
  outcome: AscExecOutcome,
  command: string,
  options: { maxDataBytes?: number } = {},
): AscToolResult {
  const errorClass = classifyError(outcome)
  const rawText = outcome.stdout.trim()
  const text = outcome.data === undefined && rawText.length > 0 ? redact(rawText).slice(0, 2_000) : undefined
  let summary: string
  if (outcome.ok) {
    if (outcome.data !== undefined) summary = summarize(outcome.data)
    else summary = text === undefined ? 'command completed (no output)' : (text.split('\n')[0] ?? '').slice(0, 200)
  } else if (errorClass === 'timeout') {
    summary = `timed out after ${outcome.durationMs} ms`
  } else if (errorClass === 'cancelled') {
    summary = 'cancelled'
  } else if (outcome.data !== undefined) {
    summary = summarize(outcome.data)
  } else {
    summary = `exited with code ${outcome.exitCode}`
  }

  let data: unknown
  let dataOmitted: boolean | undefined
  let dataBytes: number | undefined
  if (outcome.data !== undefined) {
    let serialized = ''
    try {
      serialized = JSON.stringify(outcome.data)
    } catch {
      serialized = ''
    }
    // Compare in UTF-8 bytes: the documented unit for `maxDataBytes` and
    // `dataBytes`. Comparing code units would let multibyte payloads (CJK,
    // emoji) exceed the budget by up to 3-4x.
    const serializedBytes = Buffer.byteLength(serialized, 'utf8')
    if (serialized.length > 0 && serializedBytes > (options.maxDataBytes ?? 8_000)) {
      dataOmitted = true
      dataBytes = serializedBytes
    } else {
      data = outcome.data
    }
  }

  return {
    ok: outcome.ok,
    exitCode: outcome.exitCode,
    command,
    durationMs: outcome.durationMs,
    summary,
    ...(errorClass === undefined ? {} : { errorClass, hint: HINTS[errorClass] }),
    ...(data === undefined ? {} : { data: data as JsonValue }),
    ...(dataOmitted ? { dataOmitted: true, ...(dataBytes === undefined ? {} : { dataBytes }) } : {}),
    ...(text === undefined ? {} : { text }),
    ...(stderrTail(outcome.stderr) === undefined ? {} : { stderrTail: stderrTail(outcome.stderr) }),
    ...(outcome.truncated ? { truncated: true } : {}),
    ...(outcome.spillPath === undefined ? {} : { spillPath: outcome.spillPath }),
    ...(outcome.timedOut ? { timedOut: true } : {}),
    ...(outcome.aborted ? { aborted: true } : {}),
  }
}

/** Render a result as model-facing text. */
export function renderResult(value: AscToolResult): ContentBlock[] {
  const lines: string[] = [`> ${value.command}`]
  if (!value.ok) lines.push(`exit code ${value.exitCode}`)
  lines.push(value.summary)
  if (value.text && value.text !== value.summary) lines.push(value.text)
  if (value.dataOmitted) {
    // `data` is dropped without a spill file, so only point at a spill when
    // the subprocess seam actually kept one (truncated stdout).
    const recovery =
      value.spillPath === undefined
        ? 'narrow the query (filters/limit)'
        : `narrow the query (filters/limit) or read the spilled output at ${value.spillPath}`
    lines.push(`payload omitted (${value.dataBytes ?? 'many'} bytes): ${recovery}`)
  }
  if (value.stderrTail) lines.push(`stderr (tail):\n${value.stderrTail}`)
  if (value.hint) lines.push(`next: ${value.hint}`)
  if (value.spillPath) lines.push(`full output: ${value.spillPath}`)
  return [{ type: 'text', text: lines.join('\n') }]
}
