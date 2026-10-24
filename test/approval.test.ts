import { describe, expect, it } from 'vitest'
import { decideCall, inspectCall } from '../src/approval.js'
import { makeConfig } from './helpers.js'

describe('approval policy', () => {
  it('ignores tools that are not ours', () => {
    expect(decideCall(makeConfig(), 'bash', {})).toBeUndefined()
  })

  it('allows read-only actions in read-only mode', () => {
    expect(decideCall(makeConfig(), 'asc_apps', { action: 'list' })).toBeUndefined()
    expect(decideCall(makeConfig(), 'asc_search', { query: 'builds' })).toBeUndefined()
  })

  it('refuses mutations in read-only mode before any process starts', () => {
    const decision = decideCall(makeConfig(), 'asc_builds', {
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
    const decision = decideCall(config, 'asc_builds', { action: 'upload', file: 'App.ipa' })
    expect(decision?.kind).toBe('deny')
    if (decision?.kind === 'deny') {
      expect(decision.reason).toMatch(/confirm: true/)
      expect(decision.info.code).toBe('ASC_CONFIRM_REQUIRED')
    }
  })

  it('asks for approval for confirmed mutations in write mode', () => {
    const config = makeConfig({ mode: 'write' })
    const decision = decideCall(config, 'asc_metadata', {
      action: 'apply',
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
    expect(decideCall(config, 'asc_apps', { action: 'view', confirm: true })).toBeUndefined()
    expect(
      decideCall(config, 'asc_builds', { action: 'upload', file: 'App.ipa', confirm: true }),
    ).toBeUndefined()
  })

  it('classifies asc_run dynamically', () => {
    const config = makeConfig()
    expect(inspectCall('asc_run', { args: ['apps', 'list'] })?.kind).toBe('read')
    expect(inspectCall('asc_run', { args: ['builds', 'upload'] })?.kind).toBe('write')
    expect(inspectCall('asc_run', { args: ['auth', 'login'] })?.kind).toBe('forbidden')
    expect(inspectCall('asc_run', { args: ['something', 'odd'] })?.kind).toBe('unknown')

    const readOnly = decideCall(config, 'asc_run', { args: ['builds', 'upload'], confirm: true })
    expect(readOnly?.kind).toBe('deny')

    const write = makeConfig({ mode: 'write' })
    expect(decideCall(write, 'asc_run', { args: ['builds', 'upload'], confirm: true })?.kind).toBe('ask')
    expect(decideCall(write, 'asc_run', { args: ['builds', 'upload'] })?.kind).toBe('deny')
    expect(decideCall(write, 'asc_run', { args: ['apps', 'list'] })).toBeUndefined()
  })

  it('never lets an unrecognized write command run on the model confirm alone', () => {
    const write = makeConfig({ mode: 'write' })
    // The model says confirm: true; a human must still approve.
    expect(decideCall(write, 'asc_run', { args: ['users', 'invite', '--email', 'x@y.z'], confirm: true })?.kind).toBe(
      'ask',
    )
    expect(decideCall(write, 'asc_run', { args: ['users', 'invite'], confirm: false })?.kind).toBe('deny')
  })

  it('asks before running an unrecognized command in read-only mode', () => {
    const decision = decideCall(makeConfig(), 'asc_run', { args: ['account', 'status'] })
    expect(decision?.kind).toBe('ask')
    if (decision?.kind === 'ask') expect(decision.reason).toMatch(/cannot be proven read-only/)
  })

  it('can refuse unrecognized commands outright in read-only mode', () => {
    const decision = decideCall(makeConfig({ unknownCommands: 'deny' }), 'asc_run', { args: ['account', 'status'] })
    expect(decision?.kind).toBe('deny')
    if (decision?.kind === 'deny') expect(decision.info.code).toBe('ASC_UNKNOWN_COMMAND')
  })

  it('requires confirm for local-only writes', () => {
    const missing = decideCall(makeConfig(), 'asc_metadata', { action: 'init', dir: './metadata' })
    expect(missing?.kind).toBe('deny')
    if (missing?.kind === 'deny') expect(missing.info.code).toBe('ASC_CONFIRM_REQUIRED')
    const confirmed = decideCall(makeConfig(), 'asc_metadata', { action: 'init', dir: './metadata', confirm: true })
    expect(confirmed?.kind).toBe('ask')
    expect(
      decideCall(makeConfig({ requireApproval: false }), 'asc_metadata', { action: 'init', dir: './metadata', confirm: true }),
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
    expect(decideCall(makeConfig(), 'asc_apps', { action: 'delete-everything' })?.kind).toBe('deny')
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
