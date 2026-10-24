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

const specs: ActionSpec[] = []

function define(spec: ActionSpec): void {
  specs.push(spec)
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
  build: (args, context) => {
    const group = str(args, 'group')
    if (!group) throw new Error('asc: `group` is required (beta group id or name)')
    const buildId = str(args, 'buildId')
    const argv = ['builds', 'add-groups', '--app', app(args, context), '--group', group]
    if (buildId) {
      argv.push('--build-id', buildId)
    } else {
      argv.push('--latest')
    }
    pushValue(argv, '--version', str(args, 'version'))
    pushValue(argv, '--platform', str(args, 'platform'))
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
  build: (args, context) => {
    const argv = ['publish', 'appstore', '--app', app(args, context), '--version', required(args, 'version')]
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
