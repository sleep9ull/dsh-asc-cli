import { describe, expect, it } from 'vitest'
import type { AscExecOutcome } from '../src/exec.js'
import { redact } from '../src/exec.js'
import { classifyError, formatResult, renderResult, summarize } from '../src/format.js'

function outcome(overrides: Partial<AscExecOutcome> = {}): AscExecOutcome {
  return {
    ok: true,
    exitCode: 0,
    exitSignal: null,
    durationMs: 12,
    timedOut: false,
    aborted: false,
    stdout: '{}',
    stderr: '',
    truncated: false,
    parseFailed: false,
    ...overrides,
  }
}

describe('redaction', () => {
  it('removes private keys, tokens and credential assignments', () => {
    const text = [
      '-----BEGIN PRIVATE KEY-----',
      'MIGTAgEAMBMGByqGSM',
      '-----END PRIVATE KEY-----',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      'password=hunter2',
    ].join('\n')
    const clean = redact(text)
    expect(clean).toContain('[redacted private key]')
    expect(clean).toContain('[redacted token]')
    expect(clean).toContain('password=[redacted]')
    expect(clean).not.toContain('hunter2')
  })
})

describe('summarize', () => {
  it('summarizes JSON:API collections compactly', () => {
    const summary = summarize({
      data: [
        { id: '1', attributes: { name: 'Focus', bundleId: 'com.example.focus' } },
        { id: '2', attributes: { name: 'Timer', bundleId: 'com.example.timer' } },
      ],
    })
    expect(summary).toContain('2 item(s)')
    expect(summary).toContain('name=Focus')
    expect(summary).toContain('bundleId=com.example.timer')
  })

  it('summarizes API errors', () => {
    const summary = summarize({ errors: [{ title: 'FORBIDDEN', detail: 'The API key lacks access' }] })
    expect(summary).toContain('API errors (1)')
    expect(summary).toContain('FORBIDDEN: The API key lacks access')
  })

  it('summarizes readiness payloads', () => {
    const summary = summarize({ ready: false, blockers: [{ id: 'a' }, { id: 'b' }], warnings: [] })
    expect(summary).toContain('ready=false')
    expect(summary).toContain('blockers=2')
  })
})

describe('error classification', () => {
  it('maps process facts to an error class', () => {
    expect(classifyError(outcome({ ok: false, exitCode: 1, timedOut: true }))).toBe('timeout')
    expect(classifyError(outcome({ ok: false, exitCode: -1, aborted: true }))).toBe('cancelled')
    expect(classifyError(outcome({ ok: false, exitCode: 1, stderr: 'HTTP 401 Unauthorized' }))).toBe('auth')
    expect(classifyError(outcome({ ok: false, exitCode: 1, stderr: 'HTTP 409 conflict' }))).toBe(
      'state-conflict',
    )
    expect(classifyError(outcome({ ok: false, exitCode: 1, stderr: 'HTTP 429 rate limit' }))).toBe('rate-limit')
    expect(classifyError(outcome({ ok: false, exitCode: 1, stderr: 'unknown flag: --nope' }))).toBe('usage')
    expect(classifyError(outcome({ ok: false, exitCode: -1, stderr: 'spawn asc ENOENT' }))).toBe('missing-binary')
  })
})

describe('result formatting', () => {
  it('renders a compact text block with hints', () => {
    const result = formatResult(
      outcome({ ok: false, exitCode: 1, stderr: 'HTTP 403 Forbidden: missing App Manager role' }),
      'asc apps list --output json',
    )
    expect(result.ok).toBe(false)
    expect(result.errorClass).toBe('auth')
    expect(result.hint).toMatch(/auth status --validate/)
    const blocks = renderResult(result)
    expect(blocks[0]?.type).toBe('text')
    if (blocks[0]?.type === 'text') {
      expect(blocks[0].text).toContain('exit code 1')
      expect(blocks[0].text).toContain('next:')
    }
  })

  it('exposes spill metadata when output was truncated', () => {
    const result = formatResult(
      outcome({ truncated: true, spillPath: '/tmp/spill.txt', data: { data: [] } }),
      'asc builds list',
    )
    expect(result.truncated).toBe(true)
    expect(result.spillPath).toBe('/tmp/spill.txt')
  })
})

describe('structured projectors', () => {
  it('projects validate readiness into ordered remediation steps', () => {
    const summary = summarize({
      summary: { errors: 2, warnings: 1, blocking: 2 },
      remediation: {
        totalActionable: 2,
        steps: [
          { severity: 'error', message: 'Add a privacy policy URL' },
          { severity: 'warning', message: 'Provide a demo account' },
        ],
      },
      checks: [{}, {}],
    })
    expect(summary).toContain('blocking=2')
    expect(summary).toContain('errors=2')
    expect(summary).toContain('1. [error] Add a privacy policy URL')
    expect(summary).toContain('2. [warning] Provide a demo account')
  })

  it('projects the status dashboard headline and next commands', () => {
    const summary = summarize({
      summary: {
        health: 'WAITING_FOR_REVIEW',
        nextAction: 'wait for review',
        blockers: [{ message: 'Missing privacy URL' }],
        nextCommands: ['asc status --app 1 --until review-done'],
      },
    })
    expect(summary).toContain('health=WAITING_FOR_REVIEW')
    expect(summary).toContain('next=wait for review')
    expect(summary).toContain('blocker: Missing privacy URL')
    expect(summary).toContain('asc status --app 1 --until review-done')
  })

  it('projects metadata counters', () => {
    const summary = summarize({ applied: 2, total: 3, succeeded: 2, failed: 1, adds: ['a'], updates: ['b'] })
    expect(summary).toContain('total=3')
    expect(summary).toContain('succeeded=2')
    expect(summary).toContain('failed=1')
    expect(summary).toContain('adds=1')
  })

  it('keeps small next-build-number payloads compact', () => {
    expect(summarize({ nextBuildNumber: '43', latestUploadBuildNumber: '42' })).toContain('nextBuildNumber=43')
  })
})

describe('payload size guard', () => {
  it('omits data above maxDataBytes and says how to recover', () => {
    const large = { data: Array.from({ length: 200 }, (_, index) => ({ id: String(index), attributes: { name: `app-${index}` } })) }
    const result = formatResult(outcome({ data: large }), 'asc apps list', { maxDataBytes: 512 })
    expect(result.ok).toBe(true)
    expect(result.data).toBeUndefined()
    expect(result.dataOmitted).toBe(true)
    expect(result.dataBytes).toBeGreaterThan(512)
    const text = renderResult(result)[0]
    if (text?.type === 'text') expect(text.text).toContain('payload omitted')
  })

  it('keeps data below the threshold', () => {
    const result = formatResult(outcome({ data: { data: [{ id: '1' }] } }), 'asc apps list', { maxDataBytes: 4_096 })
    expect(result.dataOmitted).toBeUndefined()
    expect(result.data).toEqual({ data: [{ id: '1' }] })
  })
})
