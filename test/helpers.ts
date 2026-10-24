import type { Config } from '../src/config.js'

/** Build a complete config for tests. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ascPath: 'asc',
    mode: 'read-only',
    requireApproval: true,
    timeoutMs: 60_000,
    longTimeoutMs: 1_800_000,
    maxOutputBytes: 262_144,
    bypassKeychain: false,
    telemetryDisabled: true,
    allowValueExpansion: false,
    unknownCommands: 'ask',
    allowProvision: false,
    maxDataBytes: 8_000,
    approvedActions: [],
    checkUpdates: false,
    env: {},
    ...overrides,
  }
}

/** Minimal ToolRunContext stand-in. */
export function makeExec(): {
  signal: AbortSignal
  agent?: { session: unknown }
} {
  return { signal: new AbortController().signal }
}
