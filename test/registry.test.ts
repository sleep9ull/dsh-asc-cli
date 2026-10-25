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
      'asc.apps-list',
      'asc.testflight-crashes',
      'asc_plan.validate',
      'asc_plan.status',
      'asc_apply.upload',
      'asc_apply.metadata-apply',
      'asc_apply.publish',
    ]) {
      expect(keys).toContain(key)
    }
  })

  it('builds read commands with explicit JSON-friendly limits', () => {
    expect(build('asc', 'apps-list')).toEqual(['apps', 'list', '--limit', '20'])
    expect(build('asc', 'apps-list', { name: 'Focus', limit: 5 })).toEqual([
      'apps',
      'list',
      '--limit',
      '5',
      '--name',
      'Focus',
    ])
    expect(build('asc', 'apps-view')).toEqual(['apps', 'view', '--id', '111'])
    expect(build('asc', 'builds-list', { app: '42', platform: 'IOS' })).toEqual([
      'builds',
      'list',
      '--app',
      '42',
      '--limit',
      '20',
      '--platform',
      'IOS',
    ])
    expect(build('asc', 'testflight-groups', { internal: true })).toEqual([
      'testflight',
      'groups',
      'list',
      '--app',
      '111',
      '--internal',
    ])
    expect(build('asc', 'reviews-list', { app: '7', limit: 5, sort: '-createdDate' })).toEqual([
      'reviews',
      'list',
      '--app',
      '7',
      '--limit',
      '5',
      '--sort',
      '-createdDate',
    ])
  })

  it('passes --exclude-expired to builds list and next-number', () => {
    expect(build('asc', 'builds-list', { excludeExpired: true })).toContain('--exclude-expired')
    expect(build('asc', 'builds-next-number', { version: '1.2.3', excludeExpired: true })).toEqual([
      'builds',
      'next-build-number',
      '--app',
      '111',
      '--version',
      '1.2.3',
      '--exclude-expired',
    ])
  })

  it('builds upload commands from the file extension', () => {
    expect(build('asc_apply', 'upload', { file: '/tmp/App.ipa', version: '1.2.3' })).toEqual([
      'builds',
      'upload',
      '--app',
      '111',
      '--ipa',
      '/tmp/App.ipa',
      '--version',
      '1.2.3',
    ])
    expect(
      build('asc_apply', 'upload', {
        file: '/tmp/App.pkg',
        version: '1.2.3',
        buildNumber: '42',
        wait: true,
      }),
    ).toEqual([
      'builds',
      'upload',
      '--app',
      '111',
      '--pkg',
      '/tmp/App.pkg',
      '--version',
      '1.2.3',
      '--build-number',
      '42',
      '--wait',
    ])
  })

  it('only passes --confirm where the asc command accepts it', () => {
    expect(
      build('asc_apply', 'groups', { app: '111', group: 'Internal', submit: true, confirm: true }),
    ).toEqual(['builds', 'add-groups', '--app', '111', '--group', 'Internal', '--latest', '--submit', '--confirm'])
    expect(build('asc_apply', 'groups', { app: '111', group: 'Internal', submit: true })).not.toContain('--confirm')
    expect(
      build('asc_apply', 'metadata-apply', { version: '1.2.3', dir: './metadata', confirm: true }),
    ).toContain('--confirm')
    expect(
      build('asc_apply', 'metadata-apply', { version: '1.2.3', dir: './metadata', dryRun: true }),
    ).toContain('--dry-run')
  })

  it('builds the release pipeline commands', () => {
    expect(build('asc_plan', 'status', { app: '7', until: 'review-done', timeout: '2h' })).toEqual([
      'status',
      '--app',
      '7',
      '--until',
      'review-done',
      '--timeout',
      '2h',
    ])
    expect(
      build('asc_apply', 'publish', {
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
    const spec = specFor('asc', 'apps-view')
    if (!spec) throw new Error('missing spec')
    expect(() => spec.build({}, { config: makeConfig(), cwd: '/tmp' })).toThrow(/missing required `app`/)
  })

  it('rejects actions that need a version or directory', () => {
    expect(() => build('asc_plan', 'metadata-plan', { dir: './metadata' })).toThrow(/version/)
    expect(() => build('asc_apply', 'metadata-apply', { version: '1.0.0' })).toThrow(/dir/)
  })
})

describe('v0.1.2 safety contract', () => {
  it('requires confirm for every local-write action', () => {
    expect(specFor('asc_apply', 'metadata-init')?.kind).toBe('local-write')
    expect(specFor('asc_apply', 'metadata-init')?.needsConfirm).toBe(true)
    expect(specFor('asc_plan', 'metadata-plan')?.kind).toBe('local-write')
    expect(specFor('asc_plan', 'metadata-plan')?.needsConfirm).toBe(true)
    expect(specFor('asc_setup', 'install-skills')?.needsConfirm).toBe(true)
  })

  it('passes --platform to release stage', () => {
    const argv = build('asc_apply', 'stage', {
      version: '1.2.3',
      buildId: 'b1',
      metadataDir: './metadata',
      platform: 'MAC_OS',
      confirm: true,
    })
    expect(argv).toContain('--platform')
    expect(argv[argv.indexOf('--platform') + 1]).toBe('MAC_OS')
  })
})

describe('pre-approval argument guards', () => {
  it('rejects upload dryRun + wait, and allows either one alone', () => {
    expect(() => build('asc_apply', 'upload', { file: '/tmp/App.ipa', dryRun: true, wait: true })).toThrow(
      /--dry-run.*--wait/,
    )
    expect(build('asc_apply', 'upload', { file: '/tmp/App.ipa', dryRun: true })).toContain('--dry-run')
    expect(build('asc_apply', 'upload', { file: '/tmp/App.ipa', dryRun: true })).not.toContain('--wait')
    expect(build('asc_apply', 'upload', { file: '/tmp/App.ipa', wait: true })).toContain('--wait')
  })

  it('requires version and build number for .pkg uploads but not .ipa', () => {
    expect(() => build('asc_apply', 'upload', { file: '/tmp/App.pkg' })).toThrow(/--version.*--build-number/)
    expect(() => build('asc_apply', 'upload', { file: '/tmp/App.pkg', version: '1.0' })).toThrow(/--build-number/)
    expect(() => build('asc_apply', 'upload', { file: '/tmp/App.pkg', buildNumber: '42' })).toThrow(/--version/)
    expect(build('asc_apply', 'upload', { file: '/tmp/App.ipa' })).toEqual([
      'builds',
      'upload',
      '--app',
      '111',
      '--ipa',
      '/tmp/App.ipa',
    ])
  })

  it('rejects groups submit + dryRun and requires an app when app-less latest has no defaultAppId', () => {
    expect(() => build('asc_apply', 'groups', { group: 'G', submit: true, dryRun: true })).toThrow(
      /--submit.*--dry-run/,
    )
    // The configured defaultAppId is a documented fallback for the latest form.
    expect(build('asc_apply', 'groups', { group: 'G' })).toEqual([
      'builds',
      'add-groups',
      '--app',
      '111',
      '--group',
      'G',
      '--latest',
    ])
    const withoutDefault: BuildContext = { config: makeConfig(), cwd: '/tmp' }
    const spec = specFor('asc_apply', 'groups')
    if (!spec) throw new Error('missing spec')
    expect(() => spec.build({ group: 'G' }, withoutDefault)).toThrow(/defaultAppId/)
  })

  it('builds groups from buildId without app/version/platform, and from app otherwise', () => {
    const bare: BuildContext = { config: makeConfig(), cwd: '/tmp' }
    const spec = specFor('asc_apply', 'groups')
    if (!spec) throw new Error('missing spec')
    expect(spec.build({ group: 'G', buildId: 'B', app: '999', version: '1.0', platform: 'IOS' }, bare)).toEqual([
      'builds',
      'add-groups',
      '--build-id',
      'B',
      '--group',
      'G',
    ])
    expect(spec.build({ group: 'G', app: '999' }, bare)).toEqual([
      'builds',
      'add-groups',
      '--app',
      '999',
      '--group',
      'G',
      '--latest',
    ])
  })

  it('requires stage version/buildId and exactly one metadata source', () => {
    expect(() => build('asc_apply', 'stage', { buildId: 'B', metadataDir: 'm' })).toThrow(/--version/)
    expect(() => build('asc_apply', 'stage', { version: '1.2.3', metadataDir: 'm' })).toThrow(/--build-id/)
    expect(() => build('asc_apply', 'stage', { version: '1.2.3', buildId: 'B' })).toThrow(/metadata/)
    expect(() =>
      build('asc_apply', 'stage', {
        version: '1.2.3',
        buildId: 'B',
        metadataDir: 'm',
        copyMetadataFrom: '1.0.0',
      }),
    ).toThrow(/metadata/)
    expect(
      build('asc_apply', 'stage', { version: '1.2.3', buildId: 'B', copyMetadataFrom: '1.0.0' }),
    ).toEqual([
      'release',
      'stage',
      '--app',
      '111',
      '--version',
      '1.2.3',
      '--build-id',
      'B',
      '--copy-metadata-from',
      '1.0.0',
    ])
  })

  it('requires exactly one publish source and pkg version/build number', () => {
    expect(() => build('asc_apply', 'publish', {})).toThrow(/--ipa.*--pkg|--pkg.*--ipa/)
    expect(() => build('asc_apply', 'publish', { ipa: 'a.ipa', pkg: 'a.pkg' })).toThrow(/--ipa.*--pkg/)
    expect(() => build('asc_apply', 'publish', { pkg: 'a.pkg' })).toThrow(/--version.*--build-number/)
    expect(() => build('asc_apply', 'publish', { pkg: 'a.pkg', version: '1.0' })).toThrow(/--build-number/)
    expect(build('asc_apply', 'publish', { ipa: 'a.ipa' })).toEqual([
      'publish',
      'appstore',
      '--app',
      '111',
      '--ipa',
      'a.ipa',
    ])
    expect(build('asc_apply', 'publish', { pkg: 'a.pkg', version: '1.0', buildNumber: '7' })).toEqual([
      'publish',
      'appstore',
      '--app',
      '111',
      '--version',
      '1.0',
      '--pkg',
      'a.pkg',
      '--build-number',
      '7',
    ])
  })

  it('rejects testflight-groups internal + external', () => {
    expect(() => build('asc', 'testflight-groups', { internal: true, external: true })).toThrow(
      /--internal.*--external/,
    )
    expect(build('asc', 'testflight-groups', { internal: true })).toEqual([
      'testflight',
      'groups',
      'list',
      '--app',
      '111',
      '--internal',
    ])
  })

  it('exposes the same context-free validator to the approval layer', () => {
    const spec = specFor('asc_apply', 'publish')
    expect(spec?.validate?.({})).toMatch(/--ipa.*--pkg/)
    expect(spec?.validate?.({ ipa: 'a.ipa' })).toBeUndefined()
    expect(specFor('asc_apply', 'upload')?.validate?.({ file: 'a.pkg' })).toMatch(/--build-number/)
  })
})
