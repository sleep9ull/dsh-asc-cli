import Schema from '@deepseek-ai/schemastery'

/**
 * How the plugin treats mutating `asc` commands.
 *
 * - `read-only`: append `--read-only` / `ASC_READ_ONLY=1` to every call and
 *   refuse mutating actions before a child process is started.
 * - `write`: allow mutating actions, but only with an explicit per-call
 *   `confirm` and (by default) a host approval prompt.
 */
export type AscMode = 'read-only' | 'write'

/** Plugin configuration, validated by Cordis when the profile loads. */
export interface Config {
  /** `asc` executable: a bare PATH name or an absolute path. */
  ascPath: string
  /** Named `asc` auth profile passed as `--profile`. */
  profile?: string
  /** Read-only by default; write mode requires `confirm` on every mutation. */
  mode: AscMode
  /** Ask the host approval service before executing a mutating action. */
  requireApproval: boolean
  /** Timeout for ordinary commands, in milliseconds. */
  timeoutMs: number
  /** Timeout for long-running actions (upload, release wait), in milliseconds. */
  longTimeoutMs: number
  /** Cap for a single model-facing result, in bytes. Overflow spills to a file. */
  maxOutputBytes: number
  /** Working directory for `asc`; defaults to the session working directory. */
  workdir?: string
  /** Set `ASC_BYPASS_KEYCHAIN=1` for config-backed credentials (CI / headless). */
  bypassKeychain: boolean
  /** Set `ASC_TELEMETRY_DISABLED=1` (recommended for agent use). */
  telemetryDisabled: boolean
  /**
   * Allow `asc`'s `@env:NAME` / `@file:PATH` value expansion for model-provided
   * arguments. Disabled by default: expansion reads local files (outside the
   * sandbox the harness applies to its own file tools), so it is a deliberate
   * opt-in.
   */
  allowValueExpansion: boolean
  /**
   * How to treat `asc` commands the classifier cannot prove read-only.
   * - `ask`: request host approval, and fail closed without an approval channel.
   * - `deny`: refuse them outright.
   * Write mode always requires `confirm` and approval for these commands.
   */
  unknownCommands: 'ask' | 'deny'
  /** Allow `asc_setup` action `provision` to download a pinned `asc` binary. */
  allowProvision: boolean
  /** Override the directory provisioned binaries are cached in. */
  cacheDir?: string
  /** Omit `data` from a result when its JSON exceeds this many bytes. */
  maxDataBytes: number
  /** Extra environment entries layered onto the scrubbed parent environment. */
  env: Record<string, string>
  /** Default App Store Connect app id when a tool call omits `app`. */
  defaultAppId?: string
}

export const Config: Schema<Config> = Schema.object({
  ascPath: Schema.string().default('asc'),
  profile: Schema.string(),
  mode: Schema.union(['read-only', 'write']).default('read-only'),
  requireApproval: Schema.boolean().default(true),
  timeoutMs: Schema.number().default(60_000),
  longTimeoutMs: Schema.number().default(1_800_000),
  maxOutputBytes: Schema.number().default(262_144),
  workdir: Schema.string(),
  bypassKeychain: Schema.boolean().default(false),
  telemetryDisabled: Schema.boolean().default(true),
  allowValueExpansion: Schema.boolean().default(false),
  unknownCommands: Schema.union(['ask', 'deny']).default('ask'),
  allowProvision: Schema.boolean().default(false),
  cacheDir: Schema.string(),
  maxDataBytes: Schema.number().default(8_000),
  env: Schema.dict(Schema.string()).default({}),
  defaultAppId: Schema.string(),
})

export type ResolvedConfig = Config
