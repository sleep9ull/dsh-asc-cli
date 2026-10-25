import { describe, expect, it } from 'vitest'
import { decideCall, inspectCall, matchesApprovedAction } from '../src/approval.js'
import { makeConfig } from './helpers.js'

describe('approval policy', () => {
  it('ignores tools that are not ours', () => {
    expect(decideCall(makeConfig(), 'bash', {})).toBeUndefined()
  })

  it('allows read-only actions in read-only mode', () => {
    expect(decideCall(makeConfig(), 'asc', { action: 'apps-list' })).toBeUndefined()
    expect(decideCall(makeConfig(), 'asc', { action: 'discover', query: 'builds' })).toBeUndefined()
  })

  it('refuses mutations in read-only mode before any process starts', () => {
    const decision = decideCall(makeConfig(), 'asc_apply', {
      action: 'upload',
      file: 'App.ipa',
      confirm: true,
    })
    expect(decision?.kind).toBe('deny')
    if (decision?.kind === 'deny') {
      expect(decision.reason).toMatch(/read-only mode/)
      expect(decision.info.code).toBe('ASC_READ_ONLY')
    }
  })

  it('requires confirm for mutations in write mode', () => {
    const config = makeConfig({ mode: 'write' })
    const decision = decideCall(config, 'asc_apply', { action: 'upload', file: 'App.ipa' })
    expect(decision?.kind).toBe('deny')
    if (decision?.kind === 'deny') {
      expect(decision.reason).toMatch(/confirm: true/)
      expect(decision.info.code).toBe('ASC_CONFIRM_REQUIRED')
    }
  })

  it('asks for approval for confirmed mutations in write mode', () => {
    const config = makeConfig({ mode: 'write' })
    const decision = decideCall(config, 'asc_apply', {
      action: 'metadata-apply',
      version: '1.0.0',
      dir: './metadata',
      confirm: true,
    })
    expect(decision?.kind).toBe('ask')
    if (decision?.kind === 'ask') {
      expect(decision.displayReason.en).toMatch(/App Store Connect/)
      expect(decision.displayReason.zh).toContain('App Store Connect')
    }
  })

  it('can skip the approval prompt when requireApproval is false', () => {
    const config = makeConfig({ mode: 'write', requireApproval: false })
    expect(decideCall(config, 'asc', { action: 'apps-view', confirm: true })).toBeUndefined()
    expect(
      decideCall(config, 'asc_apply', { action: 'upload', file: 'App.ipa', confirm: true }),
    ).toBeUndefined()
  })

  it('classifies asc_run dynamically', () => {
    const config = makeConfig()
    const run = (args: string[]) => inspectCall('asc', { action: 'run', args })?.kind
    expect(run(['apps', 'list'])).toBe('read')
    expect(run(['builds', 'upload'])).toBe('write')
    expect(run(['auth', 'login'])).toBe('forbidden')
    expect(run(['something', 'odd'])).toBe('unknown')

    const readOnly = decideCall(config, 'asc', { action: 'run', args: ['builds', 'upload'], confirm: true })
    expect(readOnly?.kind).toBe('deny')

    const write = makeConfig({ mode: 'write' })
    expect(decideCall(write, 'asc', { action: 'run', args: ['builds', 'upload'], confirm: true })?.kind).toBe('ask')
    expect(decideCall(write, 'asc', { action: 'run', args: ['builds', 'upload'] })?.kind).toBe('deny')
    expect(decideCall(write, 'asc', { action: 'run', args: ['apps', 'list'] })).toBeUndefined()
  })

  it('never lets an unrecognized write command run on the model confirm alone', () => {
    const write = makeConfig({ mode: 'write' })
    // The model says confirm: true; a human must still approve.
    expect(
      decideCall(write, 'asc', { action: 'run', args: ['users', 'invite', '--email', 'x@y.z'], confirm: true })?.kind,
    ).toBe('ask')
    expect(decideCall(write, 'asc', { action: 'run', args: ['users', 'invite'], confirm: false })?.kind).toBe('deny')
  })

  it('asks before running an unrecognized command in read-only mode', () => {
    const decision = decideCall(makeConfig(), 'asc', { action: 'run', args: ['frobnicate', 'now'] })
    expect(decision?.kind).toBe('ask')
    if (decision?.kind === 'ask') expect(decision.reason).toMatch(/cannot be proven read-only/)
  })

  it('can refuse unrecognized commands outright in read-only mode', () => {
    const decision = decideCall(makeConfig({ unknownCommands: 'deny' }), 'asc', {
      action: 'run',
      args: ['frobnicate', 'now'],
    })
    expect(decision?.kind).toBe('deny')
    if (decision?.kind === 'deny') expect(decision.info.code).toBe('ASC_UNKNOWN_COMMAND')
  })

  it('requires confirm for local-only writes', () => {
    const missing = decideCall(makeConfig(), 'asc_apply', { action: 'metadata-init', dir: './metadata' })
    expect(missing?.kind).toBe('deny')
    if (missing?.kind === 'deny') expect(missing.info.code).toBe('ASC_CONFIRM_REQUIRED')
    const confirmed = decideCall(makeConfig(), 'asc_apply', {
      action: 'metadata-init',
      dir: './metadata',
      confirm: true,
    })
    expect(confirmed?.kind).toBe('ask')
    expect(
      decideCall(makeConfig({ requireApproval: false }), 'asc_apply', {
        action: 'metadata-init',
        dir: './metadata',
        confirm: true,
      }),
    ).toBeUndefined()
  })

  it('asks for approval before install-skills writes the global skill directory', () => {
    const decision = decideCall(makeConfig(), 'asc_setup', { action: 'install-skills', confirm: true })
    expect(decision?.kind).toBe('ask')
    if (decision?.kind === 'ask') expect(decision.displayReason.en).toMatch(/local files/)
  })

  it('refuses install-skills without confirm', () => {
    expect(decideCall(makeConfig(), 'asc_setup', { action: 'install-skills' })?.kind).toBe('deny')
  })

  it('refuses unknown actions', () => {
    expect(decideCall(makeConfig(), 'asc', { action: 'delete-everything' })?.kind).toBe('deny')
  })
})

describe('job and engine policy', () => {
  it('allows read jobs and gates write jobs by mode and approval', () => {
    const readOnly = makeConfig()
    expect(decideCall(readOnly, 'asc_job', { action: 'release-check' })).toBeUndefined()
    const blocked = decideCall(readOnly, 'asc_job', { action: 'ship-testflight', file: 'a.ipa', confirm: true })
    expect(blocked?.kind).toBe('deny')
    if (blocked?.kind === 'deny') expect(blocked.info.code).toBe('ASC_READ_ONLY')

    const write = makeConfig({ mode: 'write' })
    expect(decideCall(write, 'asc_job', { action: 'ship-testflight', file: 'a.ipa' })?.kind).toBe('deny')
    expect(decideCall(write, 'asc_job', { action: 'ship-testflight', file: 'a.ipa', confirm: true })?.kind).toBe('ask')
    expect(decideCall(write, 'asc_job', { action: 'triage-feedback' })).toBeUndefined()
    expect(decideCall(write, 'asc_job', { action: 'nope' })?.kind).toBe('deny')
  })

  it('gates engine actions', () => {
    expect(decideCall(makeConfig(), 'asc_setup', { action: 'diagnose' })).toBeUndefined()
    expect(decideCall(makeConfig(), 'asc_setup', { action: 'provision' })?.kind).toBe('deny')
    const decided = decideCall(makeConfig(), 'asc_setup', { action: 'provision', confirm: true })
    expect(decided?.kind).toBe('ask')
  })
})

// Regression: the plugin used to ask for approval on combinations `asc` would
// reject with exit 2 right after (upload --pkg, stage without metadata source,
// publish without a source, ...). They must be denied before confirm/approval.
describe('pre-approval argument validation', () => {
  function invalidReason(name: string, args: Record<string, unknown>, config = makeConfig({ mode: 'write' })): string {
    const decision = decideCall(config, name, args)
    expect(decision?.kind).toBe('deny')
    if (decision?.kind !== 'deny') throw new Error('expected deny')
    expect(decision.info.code).toBe('ASC_INVALID_ARGUMENTS')
    return decision.reason
  }

  it('rejects an upload the upstream would refuse, before confirm', () => {
    const reason = invalidReason('asc_apply', { action: 'upload', file: 'App.pkg' })
    expect(reason).toMatch(/--version/)
    expect(reason).toMatch(/--build-number/)
  })

  it('rejects dry-run conflicts instead of prompting', () => {
    expect(
      invalidReason('asc_apply', { action: 'upload', file: 'App.ipa', dryRun: true, wait: true, confirm: true }),
    ).toMatch(/--dry-run/)
    expect(
      invalidReason('asc_apply', {
        action: 'groups',
        app: '1',
        group: 'G',
        submit: true,
        dryRun: true,
        confirm: true,
      }),
    ).toMatch(/--submit/)
    expect(invalidReason('asc', { action: 'testflight-groups', internal: true, external: true })).toMatch(
      /--internal/,
    )
  })

  it('requires exactly one metadata source for stage', () => {
    expect(
      invalidReason('asc_apply', { action: 'stage', version: '1.2.3', buildId: 'B', confirm: true }),
    ).toMatch(/metadata source/)
    expect(
      invalidReason('asc_apply', {
        action: 'stage',
        version: '1.2.3',
        buildId: 'B',
        metadataDir: './metadata',
        copyMetadataFrom: '1.0.0',
        confirm: true,
      }),
    ).toMatch(/exactly one/)
  })

  it('requires exactly one publish source', () => {
    expect(invalidReason('asc_apply', { action: 'publish', confirm: true })).toMatch(/build source/)
    expect(
      invalidReason('asc_apply', { action: 'publish', ipa: 'a.ipa', pkg: 'a.pkg', confirm: true }),
    ).toMatch(/exactly one/)
  })

  it('denies before the read-only and approval branches', () => {
    // Read-only mode would answer ASC_READ_ONLY; the argument error is specific.
    expect(
      invalidReason('asc_apply', { action: 'stage', version: '1.2.3', buildId: 'B' }, makeConfig()),
    ).toMatch(/metadata source/)
    // `requireApproval: false` must not turn an invalid call into an allow.
    expect(
      invalidReason(
        'asc_apply',
        { action: 'upload', file: 'App.pkg', confirm: true },
        makeConfig({ mode: 'write', requireApproval: false }),
      ),
    ).toMatch(/--build-number/)
  })

  it('validates jobs before mode and approval', () => {
    expect(
      invalidReason('asc_job', { action: 'stage-release', version: '1.2.3', buildId: 'B' }),
    ).toMatch(/metadata source/)
    expect(
      invalidReason(
        'asc_job',
        { action: 'ship-testflight', file: 'a.pkg', confirm: true },
        makeConfig({ mode: 'write', requireApproval: false }),
      ),
    ).toMatch(/--version/)
  })

  it('still asks for a valid combination', () => {
    const write = makeConfig({ mode: 'write' })
    expect(decideCall(write, 'asc_apply', { action: 'upload', file: 'a.ipa', confirm: true })?.kind).toBe('ask')
    expect(
      decideCall(write, 'asc_apply', { action: 'groups', buildId: 'B', group: 'G', confirm: true })?.kind,
    ).toBe('ask')
  })

  // `groups` without `buildId` may use the configured default app, exactly like
  // the builder does; the validator needs the config to know that.
  it('lets groups fall back to the configured defaultAppId', () => {
    const withDefault = decideCall(
      makeConfig({ mode: 'write', defaultAppId: '123' }),
      'asc_apply',
      { action: 'groups', group: 'G', confirm: true },
    )
    expect(withDefault?.kind).toBe('ask')

    const withoutDefault = decideCall(makeConfig({ mode: 'write' }), 'asc_apply', {
      action: 'groups',
      group: 'G',
      confirm: true,
    })
    expect(withoutDefault?.kind).toBe('deny')
    if (withoutDefault?.kind === 'deny') {
      expect(withoutDefault.info.code).toBe('ASC_INVALID_ARGUMENTS')
      expect(withoutDefault.reason).toMatch(/defaultAppId/)
    }
  })

  it('accepts an optional config when inspecting a call directly', () => {
    expect(inspectCall('asc_apply', { action: 'groups', group: 'G' })?.invalid).toMatch(/defaultAppId/)
    expect(
      inspectCall('asc_apply', { action: 'groups', group: 'G' }, makeConfig({ defaultAppId: '123' }))?.invalid,
    ).toBeUndefined()
  })
})

// Regression: S1 (forbidden behind a leading flag) and S2 (download/export as read).
describe('classifier integration', () => {
  it('denies auth and web commands behind leading global flags', () => {
    const write = makeConfig({ mode: 'write', requireApproval: false })
    const cases: string[][] = [
      ['--debug', 'auth', 'token'],
      ['--profile', 'p', 'auth', 'login'],
      ['--output', 'json', 'web', 'apps', 'list'],
      ['--', 'auth', 'login'],
    ]
    for (const args of cases) {
      const decision = decideCall(write, 'asc', { action: 'run', args, confirm: true })
      expect(decision?.kind).toBe('deny')
      if (decision?.kind === 'deny') expect(decision.info.code).toBe('ASC_FORBIDDEN')
    }
  })

  it('gates a download leaf as a local write', () => {
    const argv = ['screenshots', 'download', '--id', '1', '--output', '/tmp/x.png']
    const denied = decideCall(makeConfig(), 'asc', { action: 'run', args: argv })
    expect(denied?.kind).toBe('deny')
    if (denied?.kind === 'deny') expect(denied.info.code).toBe('ASC_CONFIRM_REQUIRED')
    expect(decideCall(makeConfig(), 'asc', { action: 'run', args: argv, confirm: true })?.kind).toBe('ask')
  })
})

describe('approval exemptions', () => {
  it('matches labelled glob patterns only', () => {
    expect(matchesApprovedAction(['asc_apply.upload'], 'asc_apply.upload')).toBe(true)
    expect(matchesApprovedAction(['asc_apply.*'], 'asc_apply.stage')).toBe(true)
    expect(matchesApprovedAction(['asc_apply.*'], 'asc.run: asc users invite')).toBe(false)
    expect(matchesApprovedAction(['', '  '], 'asc_apply.upload')).toBe(false)
    expect(matchesApprovedAction(['asc_apply.uploa'], 'asc_apply.upload')).toBe(false)
  })

  it('skips the prompt for an exempt write but still requires confirm and write mode', () => {
    const config = makeConfig({ mode: 'write', approvedActions: ['asc_apply.upload'] })
    expect(decideCall(config, 'asc_apply', { action: 'upload', file: 'a.ipa', confirm: true })).toBeUndefined()
    expect(decideCall(config, 'asc_apply', { action: 'upload', file: 'a.ipa' })?.kind).toBe('deny')
    const readOnly = makeConfig({ approvedActions: ['asc_apply.upload'] })
    expect(decideCall(readOnly, 'asc_apply', { action: 'upload', file: 'a.ipa', confirm: true })?.kind).toBe('deny')
    // Exemptions never apply to local writes (they are allowed in read-only mode
    // only behind approval, so an exemption there would be a silent write).
    const localWrite = makeConfig({ approvedActions: ['asc_apply.metadata-init'] })
    expect(
      decideCall(localWrite, 'asc_apply', { action: 'metadata-init', dir: './metadata', confirm: true })?.kind,
    ).toBe('ask')
  })
})
