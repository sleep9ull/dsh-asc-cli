/**
 * Single source of truth for every typed `asc` invocation the plugin can build.
 *
 * The surface is organised by intent, not by upstream command group:
 *
 * - `asc`        read-only queries (plus the `run` escape hatch and `discover`)
 * - `asc_plan`   read-only plans (`validate`, `status`, `metadata-plan`)
 * - `asc_apply`  mutations (`upload`, `groups`, metadata writes, `stage`, `publish`)
 * - `asc_job`    product-level workflows composed from the actions above
 * - `asc_setup`  environment and engine lifecycle
 *
 * Each entry maps one action to its mutation class, argv builder and timeout
 * class. A changed upstream command is a one-line edit plus a fixture update;
 * the contract test (`scripts/contract.mjs`) runs every entry through
 * `asc --help` so a rename fails CI instead of production.
 */

import type { Config } from './config.js'

/** Mutation class of one `asc` invocation. */
export type ActionKind = 'read' | 'local-write' | 'write' | 'forbidden' | 'unknown'

/** Model-provided arguments after schema validation (kept loose on purpose). */
export type ToolArgs = Record<string, unknown>

/** Execution context handed to an argv builder. */
export interface BuildContext {
  readonly config: Config
  readonly cwd: string
}

/** One row of the command registry. */
export interface ActionSpec {
  /** Tool name, e.g. `asc_apply`. */
  readonly tool: string
  /** Action name inside the tool, e.g. `upload`. */
  readonly action?: string
  /** Mutation class; `write` is refused in read-only mode. */
  readonly kind: ActionKind
  /** Whether an explicit `confirm: true` argument is required. */
  readonly needsConfirm?: boolean
  /** Whether the action commonly exceeds the ordinary timeout. */
  readonly long?: boolean
  /** Whether the command accepts `--output json` (default true). */
  readonly output?: boolean
  /**
   * Validate a model-provided argument combination before approval and before
   * the argv is built.
   *
   * Returns an actionable message (what is missing and how to fix it) when the
   * combination would be rejected by `asc`, `undefined` when it is acceptable.
   * The optional config lets guards honour documented fallbacks (`defaultAppId`);
   * the policy passes the live config and the builder passes `context.config`.
   */
  validate?(args: ToolArgs, config?: Config): string | undefined
  /** Build the argv tail (subcommand and flags), without global flags. */
  build(args: ToolArgs, context: BuildContext): string[]
}

function str(args: ToolArgs, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(args: ToolArgs, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function flag(args: ToolArgs, key: string): boolean {
  return args[key] === true
}

function app(args: ToolArgs, context: BuildContext): string {
  const explicit = str(args, 'app')
  if (explicit) return explicit
  if (context.config.defaultAppId) return context.config.defaultAppId
  throw new Error(
    'asc: missing required `app` (App Store Connect app id). Pass `app`, or set `defaultAppId` in the plugin config.',
  )
}

function pushValue(argv: string[], name: string, value: string | undefined): void {
  if (value !== undefined) argv.push(name, value)
}

function list(args: ToolArgs, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/** Default page size for list actions. */
function limit(args: ToolArgs, fallback = 20): string {
  return String(num(args, 'limit') ?? fallback)
}

function required(args: ToolArgs, key: string): string {
  const value = str(args, key)
  if (!value) throw new Error(`asc: \`${key}\` is required`)
  return value
}

// ---------------------------------------------------------------------------
// Pre-approval argument guards
//
// Each guard mirrors a combination `asc` rejects after argument parsing. They
// run before confirm/approval (`approval.ts`) and again before the argv is
// built, so a wrong combination never reaches a process or a human prompt.
// Messages name the upstream flags so the fix is mechanical.
// ---------------------------------------------------------------------------

/** `asc builds upload`: `.pkg` needs explicit version/build-number; `--dry-run` cannot wait. */
function validateUpload(args: ToolArgs): string | undefined {
  if (flag(args, 'dryRun') && flag(args, 'wait')) {
    return 'asc_apply.upload cannot combine `--dry-run` with `--wait`: asc rejects `--wait` when `--dry-run` is set. Drop `--wait` for the preview, then upload without `--dry-run` to wait for processing.'
  }
  const file = str(args, 'file')
  if (file === undefined) return 'asc_apply.upload needs `file`: the path to the .ipa or .pkg to upload.'
  if (!file.toLowerCase().endsWith('.pkg')) return undefined
  const missing = [
    ...(str(args, 'version') === undefined ? ['--version'] : []),
    ...(str(args, 'buildNumber') === undefined ? ['--build-number'] : []),
  ]
  if (missing.length === 0) return undefined
  return `asc_apply.upload needs both \`--version\` and \`--build-number\` for a .pkg (asc extracts them only from an .ipa); missing ${missing.join(' and ')}. Pass them explicitly, or upload an .ipa instead.`
}

/** `asc builds add-groups`: `--submit` cannot be previewed; `--build-id` needs no app. */
function validateGroups(args: ToolArgs, config?: Config): string | undefined {
  if (flag(args, 'dryRun') && flag(args, 'submit')) {
    return 'asc_apply.groups cannot combine `--submit` with `--dry-run`: asc rejects `--submit` when `--dry-run` is set. Preview the assignment without `--submit`, then call again without `--dry-run` to submit.'
  }
  if (str(args, 'buildId') === undefined && str(args, 'app') === undefined && config?.defaultAppId === undefined) {
    return 'asc_apply.groups needs `app` when no `buildId` is given (asc rejects `--app` together with `--build-id`, so pass exactly one form): pass `app` to target the latest build, `buildId` to target a specific build, or set `defaultAppId` in the plugin config.'
  }
  return undefined
}

/** `asc release stage`: version/build-id plus exactly one metadata source. */
function validateStage(args: ToolArgs): string | undefined {
  if (str(args, 'version') === undefined) {
    return 'asc_apply.stage needs `--version`: the marketing version to stage, e.g. 1.2.3.'
  }
  if (str(args, 'buildId') === undefined) {
    return 'asc_apply.stage needs `--build-id`: the processed build to attach to the version.'
  }
  return validateMetadataSource(args, 'asc_apply.stage')
}

/** Shared by `asc_apply.stage` and `asc_job.stage-release`. */
function validateMetadataSource(args: ToolArgs, label: string): string | undefined {
  const hasDir = str(args, 'metadataDir') !== undefined
  const hasCopy = str(args, 'copyMetadataFrom') !== undefined
  if (hasDir && hasCopy) {
    return `${label} accepts exactly one metadata source, but both \`--metadata-dir\` and \`--copy-metadata-from\` were given: asc rejects the pair. Keep one.`
  }
  if (!hasDir && !hasCopy) {
    return `${label} needs exactly one metadata source: pass \`--metadata-dir\` (apply a local metadata directory) or \`--copy-metadata-from\` (copy localization text from another version).`
  }
  return undefined
}

/** `asc publish appstore`: exactly one of ipa/pkg; `.pkg` needs version/build-number. */
function validatePublish(args: ToolArgs): string | undefined {
  const ipa = str(args, 'ipa')
  const pkg = str(args, 'pkg')
  if (ipa !== undefined && pkg !== undefined) {
    return 'asc_apply.publish accepts exactly one build source, but both `--ipa` and `--pkg` were given: asc rejects the pair. Keep one.'
  }
  if (ipa === undefined && pkg === undefined) {
    return 'asc_apply.publish needs a build source: pass `--ipa` (version optional; asc extracts it from the IPA) or `--pkg` (requires `--version` and `--build-number`).'
  }
  if (pkg === undefined) return undefined
  const missing = [
    ...(str(args, 'version') === undefined ? ['--version'] : []),
    ...(str(args, 'buildNumber') === undefined ? ['--build-number'] : []),
  ]
  if (missing.length === 0) return undefined
  return `asc_apply.publish with \`--pkg\` needs both \`--version\` and \`--build-number\` (asc cannot extract them from a package); missing ${missing.join(' and ')}. Add them, or publish an .ipa where the version is optional.`
}

/** `asc testflight groups list`: the two filters are mutually exclusive. */
function validateTestflightGroups(args: ToolArgs): string | undefined {
  if (flag(args, 'internal') && flag(args, 'external')) {
    return 'asc.testflight-groups cannot combine `--internal` and `--external`: asc treats them as mutually exclusive. Omit both to list every group, or pass exactly one.'
  }
  return undefined
}

const specs: ActionSpec[] = []

/**
 * Register one action.
 *
 * `validate` is enforced centrally here so every builder — including direct
 * calls from jobs or scripts — rejects an invalid combination before any
 * process starts. Builders still keep their own required-field checks.
 */
function define(spec: ActionSpec): void {
  const { validate, build } = spec
  specs.push({
    ...spec,
    build(args, context) {
      const invalid = validate?.(args, context.config)
      if (invalid !== undefined) throw new Error(invalid)
      return build(args, context)
    },
  })
}

// ---------------------------------------------------------------------------
// asc_setup — environment, authentication and engine lifecycle
// ---------------------------------------------------------------------------

define({ tool: 'asc_setup', action: 'version', kind: 'read', output: false, build: () => ['version'] })

define({
  tool: 'asc_setup',
  action: 'auth-status',
  kind: 'read',
  build: () => ['auth', 'status', '--validate'],
})

define({ tool: 'asc_setup', action: 'doctor', kind: 'read', build: () => ['doctor'] })

define({
  tool: 'asc_setup',
  action: 'system-status',
  kind: 'read',
  build: (args) => ['system-status', ...(flag(args, 'issuesOnly') ? ['--issues-only'] : [])],
})

define({
  tool: 'asc_setup',
  action: 'install-skills',
  kind: 'local-write',
  needsConfirm: true,
  output: false,
  build: () => ['install-skills'],
})

// `asc_setup.diagnose` and `asc_setup.provision` are engine actions: they do
// not map to an `asc` command and are handled by the tool body.

// ---------------------------------------------------------------------------
// asc — read-only inventory and queries
// ---------------------------------------------------------------------------

define({
  tool: 'asc',
  action: 'apps-list',
  kind: 'read',
  build: (args) => {
    const argv = ['apps', 'list', '--limit', limit(args)]
    pushValue(argv, '--name', str(args, 'name'))
    pushValue(argv, '--bundle-id', str(args, 'bundleId'))
    pushValue(argv, '--sort', str(args, 'sort'))
    if (flag(args, 'paginate')) argv.push('--paginate')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'apps-view',
  kind: 'read',
  build: (args, context) => ['apps', 'view', '--id', app(args, context)],
})

define({
  tool: 'asc',
  action: 'builds-list',
  kind: 'read',
  build: (args, context) => {
    const argv = ['builds', 'list', '--app', app(args, context), '--limit', limit(args)]
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--build-number', str(args, 'buildNumber'))
    pushValue(argv, '--platform', str(args, 'platform'))
    if (flag(args, 'excludeExpired')) argv.push('--exclude-expired')
    if (flag(args, 'paginate')) argv.push('--paginate')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'builds-next-number',
  kind: 'read',
  build: (args, context) => {
    const argv = ['builds', 'next-build-number', '--app', app(args, context)]
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--platform', str(args, 'platform'))
    if (flag(args, 'excludeExpired')) argv.push('--exclude-expired')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'testflight-feedback',
  kind: 'read',
  build: (args, context) => {
    const argv = ['testflight', 'feedback', 'list', '--app', app(args, context), '--limit', limit(args)]
    pushValue(argv, '--sort', str(args, 'sort'))
    if (flag(args, 'paginate')) argv.push('--paginate')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'testflight-crashes',
  kind: 'read',
  build: (args, context) => {
    const argv = ['testflight', 'crashes', 'list', '--app', app(args, context), '--limit', limit(args)]
    pushValue(argv, '--sort', str(args, 'sort'))
    if (flag(args, 'paginate')) argv.push('--paginate')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'testflight-groups',
  kind: 'read',
  validate: validateTestflightGroups,
  build: (args, context) => {
    const argv = ['testflight', 'groups', 'list', '--app', app(args, context)]
    if (flag(args, 'internal')) argv.push('--internal')
    if (flag(args, 'external')) argv.push('--external')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'reviews-list',
  kind: 'read',
  build: (args, context) => {
    const argv = ['reviews', 'list', '--app', app(args, context), '--limit', limit(args)]
    pushValue(argv, '--sort', str(args, 'sort'))
    if (flag(args, 'paginate')) argv.push('--paginate')
    return argv
  },
})

define({
  tool: 'asc',
  action: 'metadata-validate',
  kind: 'read',
  build: (args) => {
    const dir = str(args, 'dir')
    if (!dir) throw new Error('asc: `dir` is required for asc metadata-validate')
    return ['metadata', 'validate', '--dir', dir]
  },
})

// `asc.run` (arbitrary argv, classified) and `asc.discover` (`asc search`) are
// handled by the tool body and the pre-execution policy, not by this table.

// ---------------------------------------------------------------------------
// asc_plan — read-only plans
// ---------------------------------------------------------------------------

define({
  tool: 'asc_plan',
  action: 'validate',
  kind: 'read',
  build: (args, context) => {
    const argv = ['validate', '--app', app(args, context)]
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--platform', str(args, 'platform'))
    if (flag(args, 'strict')) argv.push('--strict')
    if (flag(args, 'deep')) argv.push('--deep')
    return argv
  },
})

define({
  tool: 'asc_plan',
  action: 'status',
  kind: 'read',
  long: true,
  build: (args, context) => {
    const argv = ['status', '--app', app(args, context)]
    pushValue(argv, '--platform', str(args, 'platform'))
    pushValue(argv, '--include', list(args, 'include').join(',') || undefined)
    pushValue(argv, '--until', str(args, 'until'))
    pushValue(argv, '--timeout', str(args, 'timeout'))
    return argv
  },
})

define({
  tool: 'asc_plan',
  action: 'metadata-plan',
  kind: 'local-write',
  needsConfirm: true,
  build: (args, context) => {
    const dir = str(args, 'dir')
    if (!dir) throw new Error('asc: `dir` is required for asc metadata-plan')
    const argv = ['metadata', 'plan', '--app', app(args, context), '--version', required(args, 'version'), '--dir', dir]
    pushValue(argv, '--platform', str(args, 'platform'))
    pushValue(argv, '--review-dir', str(args, 'reviewDir'))
    return argv
  },
})

// ---------------------------------------------------------------------------
// asc_apply — mutations
// ---------------------------------------------------------------------------

define({
  tool: 'asc_apply',
  action: 'upload',
  kind: 'write',
  needsConfirm: true,
  long: true,
  validate: validateUpload,
  build: (args, context) => {
    const file = str(args, 'file')
    if (!file) throw new Error('asc: `file` is required (path to .ipa or .pkg)')
    const isPkg = file.toLowerCase().endsWith('.pkg')
    const argv = ['builds', 'upload', '--app', app(args, context), isPkg ? '--pkg' : '--ipa', file]
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--build-number', str(args, 'buildNumber'))
    if (flag(args, 'dryRun')) argv.push('--dry-run')
    if (flag(args, 'wait')) argv.push('--wait')
    return argv
  },
})

define({
  tool: 'asc_apply',
  action: 'groups',
  kind: 'write',
  needsConfirm: true,
  validate: validateGroups,
  build: (args, context) => {
    const group = str(args, 'group')
    if (!group) throw new Error('asc: `group` is required (beta group id or name)')
    const buildId = str(args, 'buildId')
    // `--build-id` cannot be combined with `--app`, `--latest`, `--version` or
    // `--platform`, so the build-scoped form passes none of them.
    const argv = buildId
      ? ['builds', 'add-groups', '--build-id', buildId, '--group', group]
      : ['builds', 'add-groups', '--app', app(args, context), '--group', group, '--latest']
    if (buildId === undefined) {
      pushValue(argv, '--version', str(args, 'version'))
      pushValue(argv, '--platform', str(args, 'platform'))
    }
    if (flag(args, 'submit')) argv.push('--submit')
    if (flag(args, 'dryRun')) argv.push('--dry-run')
    // `--confirm` is only accepted together with `--submit` on this command.
    else if (flag(args, 'submit') && flag(args, 'confirm')) argv.push('--confirm')
    return argv
  },
})

define({
  tool: 'asc_apply',
  action: 'metadata-init',
  kind: 'local-write',
  needsConfirm: true,
  build: (args) => {
    const dir = str(args, 'dir')
    if (!dir) throw new Error('asc: `dir` is required for asc metadata-init')
    const argv = ['metadata', 'init', '--dir', dir]
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--locale', str(args, 'locale'))
    if (flag(args, 'force')) argv.push('--force')
    return argv
  },
})

define({
  tool: 'asc_apply',
  action: 'metadata-apply',
  kind: 'write',
  needsConfirm: true,
  build: (args, context) => {
    const dir = str(args, 'dir')
    if (!dir) throw new Error('asc: `dir` is required for asc metadata-apply')
    const argv = ['metadata', 'apply', '--app', app(args, context), '--version', required(args, 'version'), '--dir', dir]
    pushValue(argv, '--platform', str(args, 'platform'))
    pushValue(argv, '--review-dir', str(args, 'reviewDir'))
    if (flag(args, 'dryRun')) argv.push('--dry-run')
    else if (flag(args, 'confirm')) argv.push('--confirm')
    return argv
  },
})

define({
  tool: 'asc_apply',
  action: 'stage',
  kind: 'write',
  needsConfirm: true,
  long: true,
  validate: validateStage,
  build: (args, context) => {
    const argv = [
      'release',
      'stage',
      '--app',
      app(args, context),
      '--version',
      required(args, 'version'),
      '--build-id',
      required(args, 'buildId'),
    ]
    pushValue(argv, '--metadata-dir', str(args, 'metadataDir'))
    pushValue(argv, '--copy-metadata-from', str(args, 'copyMetadataFrom'))
    pushValue(argv, '--platform', str(args, 'platform'))
    if (flag(args, 'dryRun')) argv.push('--dry-run')
    else if (flag(args, 'confirm')) argv.push('--confirm')
    return argv
  },
})

define({
  tool: 'asc_apply',
  action: 'publish',
  kind: 'write',
  needsConfirm: true,
  long: true,
  validate: validatePublish,
  build: (args, context) => {
    const argv = ['publish', 'appstore', '--app', app(args, context)]
    // `--ipa` may omit the version (asc extracts it from the IPA); `--pkg`
    // requires it (enforced by the guard above).
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--ipa', str(args, 'ipa'))
    pushValue(argv, '--pkg', str(args, 'pkg'))
    pushValue(argv, '--build-number', str(args, 'buildNumber'))
    pushValue(argv, '--metadata-dir', str(args, 'metadataDir'))
    pushValue(argv, '--platform', str(args, 'platform'))
    if (flag(args, 'wait')) argv.push('--wait')
    if (flag(args, 'submit')) argv.push('--submit')
    if (flag(args, 'dryRun')) argv.push('--dry-run')
    if (!flag(args, 'dryRun') && flag(args, 'submit') && flag(args, 'confirm')) argv.push('--confirm')
    return argv
  },
})

const byKey = new Map<string, ActionSpec>()
for (const spec of specs) byKey.set(spec.action ? `${spec.tool}.${spec.action}` : spec.tool, spec)

/** Look up one registry row by tool and optional action. */
export function specFor(tool: string, action?: string): ActionSpec | undefined {
  return byKey.get(action ? `${tool}.${action}` : tool)
}

/** Every registered action key, for doctor output and tests. */
export function actionKeys(): string[] {
  return [...byKey.keys()]
}

/** Every registered action, for tooling and contract tests. */
export function allSpecs(): readonly ActionSpec[] {
  return specs
}

/** Tools that expose a registry action. */
export const ACTION_TOOLS = ['asc_setup', 'asc', 'asc_plan', 'asc_apply'] as const
