import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAudit, type AuditEntry } from '../src/audit.js'
import { makeConfig } from './helpers.js'

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
})
