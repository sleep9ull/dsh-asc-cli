/**
 * Mutation classifier for arbitrary `asc` invocations used by `asc.run`.
 *
 * Typed tools declare their kind in the registry; only the generic escape
 * hatch needs to infer it. The classifier is deliberately conservative:
 * anything it cannot prove read-only is treated as a mutation (or unknown),
 * so read-only mode can refuse it before a child process starts.
 */

import type { ActionKind } from './registry.js'

/** Subcommand tokens that mutate App Store Connect or local state. */
const WRITE_VERBS = new Set([
  'apply',
  'approve',
  'activate',
  'add',
  'archive',
  'assign',
  'cancel',
  'clear',
  'create',
  'deactivate',
  'delete',
  'disable',
  'edit',
  'enable',
  'expire',
  'fix',
  'import',
  'install-skills',
  'login',
  'logout',
  'migrate',
  'nuke',
  'push',
  'publish',
  'remove',
  'rename',
  'replace',
  'restore',
  'revoke',
  'rotate',
  'send',
  'set',
  'stage',
  'submit',
  'sync',
  'unlock',
  'update',
  'upload',
])

/** Verbs that read state without mutating it. */
const READ_VERBS = new Set([
  'capabilities',
  'count',
  'diff',
  'docs',
  'doctor',
  'download',
  'export',
  'find',
  'get',
  'history',
  'info',
  'inspect',
  'list',
  'metrics',
  'next-build-number',
  'plan',
  'report',
  'schema',
  'search',
  'show',
  'status',
  'system-status',
  'validate',
  'version',
  'view',
])

/** Root commands that never mutate App Store Connect. */
const READ_ROOTS = new Set([
  'capabilities',
  'completion',
  'diff',
  'docs',
  'doctor',
  'ipa-info',
  'pkg-info',
  'schema',
  'search',
  'status',
  'system-status',
  'validate',
  'version',
])

/**
 * Roots whose subcommands follow the verb convention (`list`, `view`, ...).
 * Only these may be inferred as read-only from a read verb; anything else
 * stays `unknown` and is treated as a mutation.
 */
const STRUCTURED_ROOTS = new Set([
  'accessibility',
  'account',
  'ads',
  'age-rating',
  'agreements',
  'analytics',
  'app-events',
  'app-tags',
  'apps',
  'asset-library',
  'actors',
  'background-assets',
  'build-bundles',
  'categories',
  'devices',
  'encryption',
  'eula',
  'finance',
  'game-center',
  'insights',
  'performance',
  'pre-orders',
  'pricing',
  'product-pages',
  'routing-coverage',
  'users',
  'xcode-cloud',
  'build-localizations',
  'builds',
  'bundle-ids',
  'certificates',
  'devices',
  'iap',
  'localizations',
  'metadata',
  'profiles',
  'release',
  'review',
  'reviews',
  'screenshots',
  'subscriptions',
  'testflight',
  'users',
  'versions',
  'video-previews',
])

/** Root commands whose default action is a read. */
const DEFAULT_READ_ROOTS = new Set(['apps'])

/** Root commands that always mutate or are unsafe for an agent. */
const WRITE_ROOTS = new Set([
  'init',
  'install-skills',
  'migrate',
  'notify',
  'publish',
  'snitch',
  'telemetry',
  'web',
  'workflow',
])

/** Root commands that are refused outright. */
const FORBIDDEN_ROOTS = new Set<string>()

function isFlag(token: string): boolean {
  return token.startsWith('-')
}

function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag)
}

/** Classify one arbitrary `asc` invocation. */
export function classifyArgv(argv: readonly string[]): ActionKind {
  if (argv.length === 0) return 'unknown'
  const root = argv[0]
  if (root === undefined || isFlag(root)) return 'unknown'
  if (FORBIDDEN_ROOTS.has(root)) return 'forbidden'

  if (root === 'auth') {
    const sub = argv[1]
    if (sub === 'status') return 'read'
    // `auth doctor` only inspects; `--fix` rewrites local credential config.
    if (sub === 'doctor') return hasFlag(argv, '--fix') ? 'local-write' : 'read'
    return 'forbidden'
  }

  if (root === 'doctor') {
    // `asc doctor --fix` repairs local keychain/config state.
    return hasFlag(argv, '--fix') ? 'local-write' : 'read'
  }

  if (root === 'docs') {
    // `docs init` writes ASC.md and may update AGENTS.md/CLAUDE.md.
    return argv[1] === 'init' ? 'local-write' : 'read'
  }

  if (root === 'api') {
    const method = argv[1]?.toUpperCase()
    if (method === 'GET') return 'read'
    if (method === undefined || isFlag(argv[1] ?? '')) return 'unknown'
    return 'write'
  }

  if (root === 'telemetry') {
    return argv[1] === 'status' ? 'read' : 'write'
  }

  if (root === 'web') return 'forbidden'

  if (root === 'workflow') {
    const sub = argv[1]
    if (sub === 'validate' || sub === 'list') return 'read'
    return 'write'
  }

  if (root === 'metadata') {
    const sub = argv[1]
    // `plan` is read-only against App Store Connect but writes a review artifact.
    if (sub === 'init' || sub === 'pull' || sub === 'plan') return 'local-write'
    if (sub === 'validate' || sub === 'status') return 'read'
    return 'write'
  }

  if (root === 'builds') {
    const sub = argv[1]
    if (sub === 'dsyms') return 'local-write'
    if (sub === 'compile' || sub === 'package') return 'local-write'
  }

  if (root === 'testflight' && argv[1] === 'config' && argv[2] === 'export') return 'local-write'

  if (root === 'init' || root === 'install-skills') return 'local-write'

  const words = argv.filter((token) => !isFlag(token)).slice(1)
  for (const word of words) {
    // Also catch compound subcommands such as `add-groups` or `expire-all`.
    const head = word.split('-')[0] ?? ''
    if (WRITE_VERBS.has(word) || WRITE_VERBS.has(head)) return 'write'
  }
  if (WRITE_ROOTS.has(root)) return 'write'
  if (READ_ROOTS.has(root)) return 'read'
  if (words.length === 0 && DEFAULT_READ_ROOTS.has(root)) return 'read'
  if (STRUCTURED_ROOTS.has(root) && words.some((word) => READ_VERBS.has(word))) return 'read'

  return 'unknown'
}

/** Human-readable explanation used in refusals. */
export function kindLabel(kind: ActionKind): string {
  switch (kind) {
    case 'read':
      return 'read-only'
    case 'local-write':
      return 'local file write'
    case 'write':
      return 'mutating App Store Connect operation'
    case 'forbidden':
      return 'forbidden command'
    default:
      return 'unrecognized command'
  }
}
