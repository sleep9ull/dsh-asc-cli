import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AscEngine, DiagnoseReport } from '../src/control/engine.js'
import {
  registerCommands,
  renderDoctorCard,
  renderStartCard,
  type CommandDefinition,
} from '../src/commands.js'

function report(overrides: Partial<DiagnoseReport> = {}): DiagnoseReport {
  return {
    resolution: { path: '/opt/asc', source: 'configured' },
    version: '5.16.0',
    compat: 'supported',
    checks: [
      { name: 'binary', ok: true, detail: '/opt/asc (source: configured)' },
      { name: 'version', ok: true, detail: 'asc 5.16.0 is within the tested range' },
      { name: 'auth', ok: true, detail: '1 stored credential(s)' },
      { name: 'default-app', ok: false, detail: 'not configured' },
    ],
    authenticated: true,
    provision: { available: false, pinned: '5.16.0', cached: false },
    ...overrides,
  }
}

describe('capability card', () => {
  it('lists every job with its risk and first intent', () => {
    const card = renderStartCard(report(), { skills: 5 })
    expect(card).toContain('asc 5.16.0')
    expect(card).toContain('release-check')
    expect(card).toContain('ship-testflight')
    expect(card).toContain('write')
    expect(card).toContain('这版能发了吗')
    expect(card).toContain('skills 5')
  })

  it('shows the next step from the report', () => {
    const card = renderStartCard(
      report({ next: { title: 'Authenticate asc in your terminal', command: 'asc auth login' } }),
      { skills: 5 },
    )
    expect(card).toContain('Next: Authenticate asc in your terminal')
    expect(card).toContain('asc auth login')
  })
})

describe('doctor card', () => {
  it('renders checks and provisioning state', () => {
    const card = renderDoctorCard(report({ next: { title: 'Ready', detail: 'try /asc' } }))
    expect(card).toContain('✓ binary')
    expect(card).toContain('✓ auth')
    expect(card).toContain('provision  disabled')
    expect(card).toContain('Next:')
  })
})

describe('command registration', () => {
  it('registers /asc and /asc-doctor when the service exists', async () => {
    const registered: CommandDefinition[] = []
    const scope = {
      commands: {
        register(definition: CommandDefinition) {
          registered.push(definition)
          return () => undefined
        },
      },
      effect(effect: () => unknown) {
        effect()
      },
    }
    const ctx = {
      inject(_deps: string[], callback: (scope: unknown) => void) {
        callback(scope)
      },
    } as unknown as Context
    const diagnose = vi.fn(async () => report())
    const engine = { diagnose } as unknown as AscEngine

    registerCommands(ctx, engine)
    expect(registered.map((definition) => definition.name)).toEqual(['asc', 'asc-doctor'])

    const start = await registered[0]?.handler({})
    expect(start?.kind).toBe('success')
    if (start?.kind === 'success') expect(start.text).toContain('Jobs:')
    expect(diagnose).toHaveBeenCalledWith({ validateAuth: false })

    const doctor = await registered[1]?.handler({})
    expect(doctor?.kind).toBe('success')
    expect(diagnose).toHaveBeenCalledWith({ validateAuth: true })
  })

  it('registers nothing when the host has no command service', () => {
    const ctx = { inject: () => undefined } as unknown as Context
    expect(() => registerCommands(ctx, {} as AscEngine)).not.toThrow()
  })
})
