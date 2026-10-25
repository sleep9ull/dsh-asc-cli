/**
 * Mutation classifier for arbitrary `asc` invocations used by `asc.run`.
 *
 * Typed tools declare their kind in the registry; only the generic escape
 * hatch needs to infer it. The classifier is deliberately conservative:
 * anything it cannot prove read-only is treated as a mutation (or unknown),
 * so read-only mode can refuse it before a child process starts.
 *
 * `asc` accepts global flags before the subcommand (`asc --debug auth token`),
 * so the first token is not necessarily the command root. Every judgement here
 * runs on `normalizeArgv(argv)`; the original argv is still what gets spawned.
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

/**
 * Verbs that read state without mutating it.
 *
 * `download` and `export` are deliberately absent: every `asc` command that
 * uses them writes a local file, so they are not evidence of a read.
 */
const READ_VERBS = new Set([
  'capabilities',
  'count',
  'current',
  'diff',
  'docs',
  'doctor',
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

/**
 * Leaf command paths that write local files even though they talk to the API.
 *
 * Matched against the leading non-flag words (so trailing flags are ignored).
 * A hit is `local-write`: the plugin demands `confirm: true` and, by default,
 * a human approval in both modes. Keep this list exact; a new upstream leaf
 * that writes files must be added here (or `scripts/classify-audit.mjs` fails).
 */
const FILE_WRITE_LEAVES: readonly (readonly string[])[] = [
  ['analytics', 'download'],
  ['localizations', 'download'],
  ['performance', 'download'],
  ['profiles', 'download'],
  ['screenshots', 'download'],
  ['video-previews', 'download'],
  ['xcode-cloud', 'artifacts', 'download'],
  ['testflight', 'testers', 'export'],
  ['certificates', 'export'],
]

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
  'workflow',
])

/** Root commands that are refused outright. */
const FORBIDDEN_ROOTS = new Set(['web'])

/** Global flags that take the following token as their value. */
const VALUE_GLOBAL_FLAGS = new Set(['--profile', '--report', '--report-file', '--output'])

/** Global flags that stand alone (also accepted as `--flag=true|false`). */
const BOOLEAN_GLOBAL_FLAGS = new Set([
  '--api-debug',
  '--debug',
  '--help',
  '--pretty',
  '--read-only',
  '--retry-log',
  '--strict-auth',
  '--version',
])

/** Result of stripping the global flags that may precede the command root. */
export interface NormalizedArgv {
  /** argv with leading global flags (and the `--` sentinel) removed. */
  readonly argv: readonly string[]
  /** First leading flag this build does not know; classification must stay `unknown`. */
  readonly unknownFlag?: string
}

/**
 * Strip leading global flags so the command root is `argv[0]`.
 *
 * Unknown flags are not guessed at: a flag this build does not know may or may
 * not consume the next token, so the caller must fall back to `unknown` instead
 * of deciding whether `auth`/`web` is the real root.
 */
export function normalizeArgv(argv: readonly string[]): NormalizedArgv {
  let index = 0
  while (index < argv.length) {
    const token = argv[index] as string
    // End-of-options sentinel: the next token is the command root.
    if (token === '--') {
      index += 1
      continue
    }
    if (!isFlag(token)) break
    const separator = token.indexOf('=')
    const name = separator > 0 ? token.slice(0, separator) : token
    if (BOOLEAN_GLOBAL_FLAGS.has(name)) {
      index += 1
      continue
    }
    if (VALUE_GLOBAL_FLAGS.has(name)) {
      index += separator > 0 ? 1 : 2
      continue
    }
    return { argv: [], unknownFlag: token }
  }
  return { argv: argv.slice(index) }
}

function isFlag(token: string): boolean {
  return token.startsWith('-')
}

function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag)
}

/** The leading non-flag words of a normalized argv (`['apps','list','123']`). */
function commandWords(argv: readonly string[]): string[] {
  return argv.filter((token) => !isFlag(token))
}

function matchesLeaf(words: readonly string[]): boolean {
  return FILE_WRITE_LEAVES.some(
    (leaf) => leaf.length <= words.length && leaf.every((segment, index) => words[index] === segment),
  )
}

/**
 * Whether this invocation is a known local-file-writing leaf command.
 *
 * Used by the runtime to skip `--output json` (which several download commands
 * would otherwise interpret as a file name).
 */
export function isFileWriteArgv(argv: readonly string[]): boolean {
  const normalized = normalizeArgv(argv)
  if (normalized.unknownFlag !== undefined) return false
  return matchesLeaf(commandWords(normalized.argv))
}

/** Classify one arbitrary `asc` invocation. */
export function classifyArgv(argv: readonly string[]): ActionKind {
  const normalized = normalizeArgv(argv)
  if (normalized.unknownFlag !== undefined) return 'unknown'
  const tokens = normalized.argv
  const root = tokens[0]
  // Normalization stops at the first non-flag token; this is defensive only.
  if (root === undefined || isFlag(root)) return 'unknown'
  if (FORBIDDEN_ROOTS.has(root)) return 'forbidden'

  if (root === 'auth') {
    const sub = tokens[1]
    if (sub === 'status') return 'read'
    // `auth doctor` only inspects; `--fix` rewrites local credential config.
    if (sub === 'doctor') return hasFlag(tokens, '--fix') ? 'local-write' : 'read'
    return 'forbidden'
  }

  if (root === 'doctor') {
    // `asc doctor --fix` repairs local keychain/config state.
    return hasFlag(tokens, '--fix') ? 'local-write' : 'read'
  }

  if (root === 'docs') {
    // `docs init` writes ASC.md and may update AGENTS.md/CLAUDE.md.
    return tokens[1] === 'init' ? 'local-write' : 'read'
  }

  if (root === 'api') {
    const method = tokens[1]?.toUpperCase()
    if (method === 'GET') return 'read'
    if (method === undefined || isFlag(tokens[1] ?? '')) return 'unknown'
    return 'write'
  }

  if (root === 'telemetry') {
    return tokens[1] === 'status' ? 'read' : 'write'
  }

  if (root === 'workflow') {
    const sub = tokens[1]
    if (sub === 'validate' || sub === 'list') return 'read'
    return 'write'
  }

  if (root === 'metadata') {
    const sub = tokens[1]
    // `plan` is read-only against App Store Connect but writes a review artifact.
    if (sub === 'init' || sub === 'pull' || sub === 'plan') return 'local-write'
    if (sub === 'validate' || sub === 'status') return 'read'
    return 'write'
  }

  if (root === 'builds') {
    const sub = tokens[1]
    if (sub === 'dsyms') return 'local-write'
    if (sub === 'compile' || sub === 'package') return 'local-write'
  }

  if (root === 'testflight' && tokens[1] === 'config' && tokens[2] === 'export') return 'local-write'

  if (root === 'init' || root === 'install-skills') return 'local-write'

  const allWords = commandWords(tokens)
  if (matchesLeaf(allWords)) return 'local-write'
  const words = allWords.slice(1)
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
