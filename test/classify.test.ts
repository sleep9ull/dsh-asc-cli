import { describe, expect, it } from 'vitest'
import { classifyArgv, isFileWriteArgv, kindLabel, normalizeArgv } from '../src/classify.js'

describe('classifyArgv', () => {
  const read: string[][] = [
    ['apps', 'list'],
    ['apps', 'view', '--id', '123'],
    ['builds', 'list', '--app', '123'],
    ['builds', 'next-build-number', '--app', '123'],
    ['testflight', 'feedback', 'list', '--app', '123'],
    ['testflight', 'crashes', 'list', '--app', '123'],
    ['testflight', 'groups', 'list', '--app', '123'],
    ['status', '--app', '123'],
    ['validate', '--app', '123', '--version', '1.2.3'],
    ['capabilities', '--output', 'json'],
    ['search', 'upload a build'],
    ['version'],
    ['doctor'],
    ['auth', 'status', '--validate'],
    ['pricing', 'current', '--app', '123'],
    ['age-rating', 'view', '--app', '123'],
    ['encryption', 'declarations', 'list', '--app', '123'],
    ['accessibility', 'list', '--app', '123'],
    ['auth', 'doctor'],
    ['api', 'GET', '/v1/apps'],
    ['workflow', 'validate'],
    ['docs', 'list'],
    ['docs', 'show', 'api-notes'],
  ]

  it.each(read)('treats %j as read-only', (...argv) => {
    expect(classifyArgv(argv)).toBe('read')
  })

  const write: string[][] = [
    ['builds', 'upload', '--app', '1', '--ipa', 'app.ipa'],
    ['builds', 'add-groups', '--app', '1', '--latest', '--group', 'g'],
    ['metadata', 'apply', '--app', '1', '--version', '1.2.3', '--dir', '.'],
    ['publish', 'appstore', '--app', '1', '--version', '1.2.3', '--submit'],
    ['release', 'stage', '--app', '1', '--version', '1.2.3', '--build-id', 'b'],
    ['testflight', 'notifications', 'send', '--build-id', 'b'],
    ['api', 'PATCH', '/v1/apps/1'],
    ['workflow', 'run', 'testflight_beta'],
    ['telemetry', 'disable'],
    ['apps', 'rename', '--app', '1', '--locale', 'en-US', '--name', 'X'],
  ]

  it.each(write)('treats %j as a mutation', (...argv) => {
    expect(classifyArgv(argv)).toBe('write')
  })

  it('classifies local-only writes separately', () => {
    expect(classifyArgv(['metadata', 'init', '--dir', './metadata'])).toBe('local-write')
    expect(classifyArgv(['metadata', 'plan', '--app', '1', '--version', '1.2.3', '--dir', './metadata'])).toBe(
      'local-write',
    )
    expect(classifyArgv(['metadata', 'pull', '--app', '1', '--version', '1.0', '--dir', '.'])).toBe('local-write')
    expect(classifyArgv(['builds', 'dsyms', '--build-id', 'b', '--output-dir', './dsyms'])).toBe(
      'local-write',
    )
    expect(classifyArgv(['docs', 'init'])).toBe('local-write')
    expect(classifyArgv(['doctor', '--fix'])).toBe('local-write')
    expect(classifyArgv(['auth', 'doctor', '--fix'])).toBe('local-write')
    expect(classifyArgv(['install-skills'])).toBe('local-write')
  })

  it('refuses auth mutations and web-session commands', () => {
    expect(classifyArgv(['auth', 'login', '--name', 'x'])).toBe('forbidden')
    expect(classifyArgv(['auth', 'logout'])).toBe('forbidden')
    expect(classifyArgv(['web', 'auth', 'login'])).toBe('forbidden')
    expect(classifyArgv(['web', 'apps', 'create'])).toBe('forbidden')
  })

  it('is conservative for unrecognized commands', () => {
    expect(classifyArgv(['something-new', 'do-stuff'])).toBe('unknown')
    expect(classifyArgv([])).toBe('unknown')
    expect(classifyArgv(['--help'])).toBe('unknown')
  })

  it('labels kinds for messages', () => {
    expect(kindLabel('read')).toBe('read-only')
    expect(kindLabel('write')).toContain('mutating')
  })
})

// Regression: S1 in docs/assessment/05-implementation-review-0.1.5.md — the
// classifier used `argv[0]` as the root, so a leading global flag demoted
// `auth login` / `web *` from forbidden to unknown and let them run.
describe('leading global flags', () => {
  it('still refuses auth and web commands behind a global flag', () => {
    const forbidden: string[][] = [
      ['--debug', 'auth', 'token'],
      ['--profile', 'p', 'auth', 'login', '--name', 'x'],
      ['--output', 'json', 'web', 'apps', 'list'],
      ['--', 'auth', 'login'],
      ['--read-only=false', 'auth', 'logout'],
      ['--report-file=/tmp/report.json', 'web', 'apps', 'list'],
    ]
    for (const argv of forbidden) expect(classifyArgv(argv)).toBe('forbidden')
  })

  it('classifies the normalized root instead of the flag', () => {
    expect(classifyArgv(['--profile', 'p', 'apps', 'list'])).toBe('read')
    expect(classifyArgv(['--debug', 'builds', 'upload', '--app', '1', '--ipa', 'a.ipa'])).toBe('write')
    expect(classifyArgv(['--output', 'json', 'screenshots', 'download', '--id', '1'])).toBe('local-write')
    expect(classifyArgv(['--api-debug', 'metadata', 'init', '--dir', '.'])).toBe('local-write')
    expect(normalizeArgv(['--pretty=true', '--retry-log', 'apps', 'list']).argv).toEqual(['apps', 'list'])
  })

  it('stays unknown for a leading flag it cannot interpret', () => {
    expect(classifyArgv(['--frobnicate', 'apps', 'list'])).toBe('unknown')
    expect(classifyArgv(['--frobnicate=1', 'auth', 'login'])).toBe('unknown')
    expect(classifyArgv(['-x', 'auth', 'login'])).toBe('unknown')
  })
})

// Regression: S2 — `download`/`export` were read verbs, so these nine leaves
// wrote local files with zero confirm and zero approval in read-only mode.
describe('file-writing download/export leaves', () => {
  const leaves: string[][] = [
    ['analytics', 'download', '--request-id', 'R', '--instance-id', 'I'],
    ['localizations', 'download', '--version', 'V', '--output', '/tmp/l'],
    ['performance', 'download', '--app', '1', '--output', '/tmp/m.json'],
    ['profiles', 'download', '--id', 'P', '--output', '/tmp/p.mobileprovision'],
    ['screenshots', 'download', '--id', '1', '--output', '/tmp/x.png'],
    ['video-previews', 'download', '--id', '1', '--output', '/tmp/v.mov'],
    ['xcode-cloud', 'artifacts', 'download', '--id', '1', '--path', '/tmp/a.zip'],
    ['testflight', 'testers', 'export', '--app', '1', '--output', '/tmp/t.csv'],
    ['certificates', 'export', '--p12-out', '/tmp/c.p12'],
  ]

  it.each(leaves)('treats %j as a local file write', (...argv) => {
    expect(classifyArgv(argv)).toBe('local-write')
  })

  it('keeps plain structured reads read-only', () => {
    expect(classifyArgv(['testflight', 'feedback', 'list', '--app', '1'])).toBe('read')
    expect(classifyArgv(['reviews', 'list', '--app', '1'])).toBe('read')
    expect(classifyArgv(['analytics', 'reports', 'view', '--app', '1'])).toBe('read')
  })

  it('still treats a write verb given as a flag value as a write', () => {
    expect(classifyArgv(['apps', 'list', '--name', 'delete'])).toBe('write')
  })

  it('exposes the file-write check the runtime uses to skip --output', () => {
    expect(isFileWriteArgv(['--profile', 'p', 'analytics', 'download'])).toBe(true)
    expect(isFileWriteArgv(['screenshots', 'download', '--id', '1'])).toBe(true)
    expect(isFileWriteArgv(['apps', 'list'])).toBe(false)
    expect(isFileWriteArgv(['--frobnicate', 'analytics', 'download'])).toBe(false)
  })
})
