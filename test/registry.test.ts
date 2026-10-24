import { describe, expect, it } from 'vitest'
import { actionKeys, specFor, type BuildContext } from '../src/registry.js'
import { makeConfig } from './helpers.js'

const context: BuildContext = { config: makeConfig({ defaultAppId: '111' }), cwd: '/tmp' }

function build(tool: string, action: string | undefined, args: Record<string, unknown> = {}): string[] {
  const spec = specFor(tool, action)
  if (!spec) throw new Error(`missing spec ${tool}.${action}`)
  return spec.build(args, context)
}

describe('command registry', () => {
  it('exposes the documented tool surface', () => {
    const keys = actionKeys()
    for (const key of [
      'asc_setup.version',
      'asc_search',
      'asc_apps.list',
      'asc_builds.upload',
      'asc_testflight.crashes',
      'asc_metadata.apply',
      'asc_release.publish',
    ]) {
      expect(keys).toContain(key)
    }
  })

  it('builds read commands with explicit JSON-friendly limits', () => {
    expect(build('asc_apps', 'list')).toEqual(['apps', 'list', '--limit', '20'])
    expect(build('asc_apps', 'list', { name: 'Focus', limit: 5 })).toEqual([
      'apps',
      'list',
      '--limit',
      '5',
      '--name',
      'Focus',
    ])
    expect(build('asc_apps', 'view')).toEqual(['apps', 'view', '--id', '111'])
    expect(build('asc_builds', 'list', { app: '42', platform: 'IOS' })).toEqual([
      'builds',
      'list',
      '--app',
      '42',
      '--limit',
      '20',
      '--platform',
      'IOS',
    ])
    expect(build('asc_testflight', 'groups', { internal: true })).toEqual([
      'testflight',
      'groups',
      'list',
      '--app',
      '111',
      '--internal',
    ])
  })

  it('builds upload commands from the file extension', () => {
    expect(build('asc_builds', 'upload', { file: '/tmp/App.ipa', version: '1.2.3' })).toEqual([
      'builds',
      'upload',
      '--app',
      '111',
      '--ipa',
      '/tmp/App.ipa',
      '--version',
      '1.2.3',
    ])
    expect(build('asc_builds', 'upload', { file: '/tmp/App.pkg', buildNumber: '42', wait: true })).toEqual([
      'builds',
      'upload',
      '--app',
      '111',
      '--pkg',
      '/tmp/App.pkg',
      '--build-number',
      '42',
      '--wait',
    ])
  })

  it('only passes --confirm where the asc command accepts it', () => {
    expect(
      build('asc_builds', 'add-groups', { group: 'Internal', submit: true, confirm: true }),
    ).toEqual(['builds', 'add-groups', '--app', '111', '--group', 'Internal', '--latest', '--submit', '--confirm'])
    expect(build('asc_builds', 'add-groups', { group: 'Internal', submit: true })).not.toContain('--confirm')
    expect(build('asc_metadata', 'apply', { version: '1.2.3', dir: './metadata', confirm: true })).toContain(
      '--confirm',
    )
    expect(build('asc_metadata', 'apply', { version: '1.2.3', dir: './metadata', dryRun: true })).toContain(
      '--dry-run',
    )
  })

  it('builds the release pipeline commands', () => {
    expect(build('asc_release', 'status', { app: '7', until: 'review-done', timeout: '2h' })).toEqual([
      'status',
      '--app',
      '7',
      '--until',
      'review-done',
      '--timeout',
      '2h',
    ])
    expect(
      build('asc_release', 'publish', {
        version: '1.2.3',
        ipa: '/tmp/App.ipa',
        submit: true,
        confirm: true,
      }),
    ).toEqual([
      'publish',
      'appstore',
      '--app',
      '111',
      '--version',
      '1.2.3',
      '--ipa',
      '/tmp/App.ipa',
      '--submit',
      '--confirm',
    ])
  })

  it('requires an app id when no default is configured', () => {
    const spec = specFor('asc_apps', 'view')
    if (!spec) throw new Error('missing spec')
    expect(() => spec.build({}, { config: makeConfig(), cwd: '/tmp' })).toThrow(/missing required `app`/)
  })

  it('rejects actions that need a version or directory', () => {
    expect(() => build('asc_metadata', 'plan', { dir: './metadata' })).toThrow(/version/)
    expect(() => build('asc_metadata', 'apply', { version: '1.0.0' })).toThrow(/dir/)
  })
})

describe('v0.1.2 safety contract', () => {
  it('requires confirm for every local-write action', () => {
    expect(specFor('asc_metadata', 'init')?.kind).toBe('local-write')
    expect(specFor('asc_metadata', 'init')?.needsConfirm).toBe(true)
    expect(specFor('asc_metadata', 'plan')?.kind).toBe('local-write')
    expect(specFor('asc_metadata', 'plan')?.needsConfirm).toBe(true)
    expect(specFor('asc_setup', 'install-skills')?.needsConfirm).toBe(true)
  })

  it('passes --platform to release stage', () => {
    const argv = build('asc_release', 'stage', {
      version: '1.2.3',
      buildId: 'b1',
      platform: 'MAC_OS',
      confirm: true,
    })
    expect(argv).toContain('--platform')
    expect(argv[argv.indexOf('--platform') + 1]).toBe('MAC_OS')
  })
})
