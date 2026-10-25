import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAudit, sanitizeArgv, type AuditEntry } from '../src/audit.js'
import { makeConfig } from './helpers.js'

// POSIX permission bits are meaningless on Windows CI; the audit contract is
// written against 0o600, so only assert there.
const itPosix = process.platform === 'win32' ? it.skip : it

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: '2026-10-24T12:00:00.000Z',
    tool: 'asc_apply',
    action: 'upload',
    kind: 'write',
    argv: ['builds', 'upload', '--ipa', 'App.ipa', '--password', 'hunter2'],
    cwd: '/tmp',
    mode: 'write',
    confirm: true,
    ok: true,
    exitCode: 0,
    durationMs: 42,
    ...overrides,
  }
}

function sinkAt(path: string): (entry: AuditEntry) => void {
  return createAudit(makeConfig({ auditLog: path }))
}

function tempLog(): string {
  return join(mkdtempSync(join(tmpdir(), 'asc-audit-')), 'audit.jsonl')
}

describe('audit trail', () => {
  it('is a no-op without auditLog', () => {
    const sink = createAudit(makeConfig())
    expect(() => sink(entry())).not.toThrow()
  })

  it('appends one redacted JSON line per call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asc-audit-'))
    const path = join(dir, 'nested', 'audit.jsonl')
    const sink = createAudit(makeConfig({ auditLog: path }))
    sink(entry())
    sink(entry({ tool: 'asc_plan', action: 'validate', kind: 'read', ok: false, exitCode: 1, errorClass: 'auth' }))
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(first.tool).toBe('asc_apply')
    expect(first.kind).toBe('write')
    expect(first.mode).toBe('write')
    expect(first.argv).toContain('App.ipa')
    expect(JSON.stringify(first)).not.toContain('hunter2')
    const second = JSON.parse(lines[1] as string) as Record<string, unknown>
    expect(second.errorClass).toBe('auth')
  })

  it('redacts inline --flag=value credentials as well as separate values', () => {
    const path = tempLog()
    sinkAt(path)(
      entry({
        argv: [
          'builds',
          'upload',
          '--ipa',
          'App.ipa',
          '--token=SECRET_INLINE',
          '--pagination-token=PAGINATION_SECRET',
          '--password',
          'hunter2',
        ],
      }),
    )
    const content = readFileSync(path, 'utf8')
    expect(content).not.toContain('SECRET_INLINE')
    expect(content).not.toContain('PAGINATION_SECRET')
    expect(content).not.toContain('hunter2')
    const parsed = JSON.parse(content.trimEnd().split('\n')[0] as string) as Record<string, unknown>
    expect(parsed.argv).toEqual([
      'builds',
      'upload',
      '--ipa',
      'App.ipa',
      '--token=[redacted]',
      '--pagination-token=[redacted]',
      '--password',
      '[redacted]',
    ])
  })

  it('caps a line at 8 KB of UTF-8 bytes without splitting multibyte characters', () => {
    const path = tempLog()
    // 4,000 CJK characters = 12,000 UTF-8 bytes in a single argv token, i.e.
    // over the 8 KB line budget in bytes but only ~4 KB in characters.
    sinkAt(path)(entry({ argv: ['builds', 'upload', '--ipa', '证'.repeat(4_000)] }))
    const line = readFileSync(path, 'utf8').trimEnd()
    const bytes = Buffer.byteLength(line, 'utf8')
    expect(bytes).toBeLessThanOrEqual(8_192)
    expect(bytes).toBeGreaterThan(8_192 - 8)
    expect(line.endsWith('…')).toBe(true)
    // A split sequence would decode as U+FFFD in the written line.
    expect(line).not.toContain('\uFFFD')
  })

  itPosix('tightens a pre-existing loose audit file to 0600', () => {
    const path = tempLog()
    writeFileSync(path, '')
    chmodSync(path, 0o644)
    expect(statSync(path).mode & 0o777).toBe(0o644)
    sinkAt(path)(entry())
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})

describe('sanitizeArgv', () => {
  it('keeps flag names and drops only their values', () => {
    expect(
      sanitizeArgv(['--TOKEN=abc', '--api-key', 'def', '--pagination-token=ghi', '--ipa', 'App.ipa']),
    ).toEqual(['--TOKEN=[redacted]', '--api-key', '[redacted]', '--pagination-token=[redacted]', '--ipa', 'App.ipa'])
  })
})
