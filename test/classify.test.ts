import { describe, expect, it } from 'vitest'
import { classifyArgv, kindLabel } from '../src/classify.js'

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
