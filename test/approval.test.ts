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
    if (decision?.kind === 'deny') expect(decision.reason).toMatch(/read-only mode/)
  })

  it('requires confirm for mutations in write mode', () => {
    const config = makeConfig({ mode: 'write' })
    const decision = decideCall(config, 'asc_builds', { action: 'upload', file: 'App.ipa' })
    expect(decision?.kind).toBe('deny')
    if (decision?.kind === 'deny') expect(decision.reason).toMatch(/confirm: true/)
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

  it('does not require approval for local-only writes', () => {
    expect(
      decideCall(makeConfig(), 'asc_metadata', { action: 'init', dir: './metadata' }),
    ).toBeUndefined()
  })

  it('refuses install-skills without confirm', () => {
    expect(decideCall(makeConfig(), 'asc_setup', { action: 'install-skills' })?.kind).toBe('deny')
    expect(
      decideCall(makeConfig({ mode: 'write' }), 'asc_setup', { action: 'install-skills', confirm: true }),
    ).toBeUndefined()
  })

  it('refuses unknown actions', () => {
    expect(decideCall(makeConfig(), 'asc_apps', { action: 'delete-everything' })?.kind).toBe('deny')
  })
})
