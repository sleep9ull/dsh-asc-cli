/**
 * Optional JSONL audit trail.
 *
 * When `auditLog` is configured, every executed `asc` invocation appends one
 * line with who/what/where: tool, action, argv, mode, confirmation, exit code,
 * duration and error class. Approval outcomes are not duplicated here — the
 * harness already records `approval/asked` and `approval/decided` in the
 * session log; this file is the team-facing, greppable trail.
 *
 * Writing is best-effort: an unwritable path must never turn a successful
 * `asc` call into a tool failure.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Config } from './config.js'
import { redact } from './exec.js'

/** One audited invocation. */
export interface AuditEntry {
  readonly ts: string
  readonly tool: string
  readonly action?: string
  readonly kind?: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly mode: 'read-only' | 'write'
  readonly confirm: boolean
  readonly ok: boolean
  readonly exitCode: number
  readonly durationMs: number
  readonly errorClass?: string
  readonly appId?: string
}

/** Sink called after every execution; `createAudit` returns a no-op without a path. */
export type AuditFn = (entry: AuditEntry) => void

/** Hard cap for one JSONL line, in UTF-8 bytes. */
const MAX_LINE_BYTES = 8_192

const ELLIPSIS = '…'

/** Credential-shaped flag names, without the leading dashes. */
const SENSITIVE_FLAG_NAMES =
  'password|passwd|token|secret|api[-_]?key|private[-_]?key|authorization|pagination[-_]?token'

/** `--token` / `-token`: the next argv token is the value. */
const SENSITIVE_FLAG = new RegExp(`^--?(?:${SENSITIVE_FLAG_NAMES})$`, 'i')

/** `--token=VALUE` / `--pagination-token=VALUE`: value is inline. */
const INLINE_SENSITIVE_FLAG = new RegExp(`^(--?(?:${SENSITIVE_FLAG_NAMES}))=`, 'i')

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a multibyte
 * character. A continuation byte (10xxxxxx) means the boundary landed inside a
 * sequence, so step back to the character's first byte.
 */
function truncateToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return buffer.subarray(0, end).toString('utf8')
}

/** Replace the value after a credential-shaped flag before anything is written. */
export function sanitizeArgv(argv: readonly string[]): string[] {
  const out: string[] = []
  let redactNext = false
  for (const token of argv) {
    if (redactNext) {
      out.push('[redacted]')
      redactNext = false
      continue
    }
    const inline = INLINE_SENSITIVE_FLAG.exec(token)
    if (inline !== null) {
      // Keep the flag, drop only the inline value: `--token=SECRET` → `--token=[redacted]`.
      out.push(`${inline[1] ?? ''}=[redacted]`)
      continue
    }
    out.push(token)
    if (SENSITIVE_FLAG.test(token)) redactNext = true
  }
  return out
}

/**
 * Build the audit sink for one config.
 *
 * @param config - plugin config; `auditLog` enables the sink.
 * @returns a function that appends one redacted JSON line per call.
 */
export function createAudit(config: Config): AuditFn {
  const path = config.auditLog
  if (path === undefined || path.trim().length === 0) return () => undefined
  return (entry) => {
    let line = redact(JSON.stringify({ ...entry, argv: sanitizeArgv(entry.argv.slice(0, 32)) }))
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      // Reserve room for the ellipsis so the written line stays within the cap.
      line = `${truncateToBytes(line, MAX_LINE_BYTES - Buffer.byteLength(ELLIPSIS, 'utf8'))}${ELLIPSIS}`
    }
    try {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `${line}\n`, { mode: 0o600 })
    } catch {
      // Auditing is best-effort; never fail the invocation because of it.
      return
    }
    // `mode` is applied on creation only; tighten a pre-existing loose file.
    // Best-effort: a foreign owner or read-only mount must not fail the call.
    try {
      if (existsSync(path)) chmodSync(path, 0o600)
    } catch {
      // ignore
    }
  }
}
