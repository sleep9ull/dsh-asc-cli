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

import { appendFileSync, mkdirSync } from 'node:fs'
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

const MAX_LINE_BYTES = 8_192

const SENSITIVE_FLAG = /^--?(?:password|passwd|token|secret|api[-_]?key|private[-_]?key|authorization)$/i

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
    if (line.length > MAX_LINE_BYTES) line = `${line.slice(0, MAX_LINE_BYTES)}…`
    try {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `${line}\n`, { mode: 0o600 })
    } catch {
      // Auditing is best-effort; never fail the invocation because of it.
    }
  }
}
