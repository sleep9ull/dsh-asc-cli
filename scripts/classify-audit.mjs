#!/usr/bin/env node
/**
 * Completion-drift gate for the mutation classifier.
 *
 * Enumerates every command path `asc` itself advertises (bash completion,
 * ~1,900 paths), classifies each one with the plugin's classifier and fails if a
 * path that obviously writes a local file is classified as `read`. A `read`
 * verdict is the only one that skips confirmation and approval, so drift there
 * silently turns a file-writing command into a read-only-mode escape hatch.
 *
 * Usage:
 *   npm run build                                   # the gate imports lib/, not src/
 *   node scripts/classify-audit.mjs [path/to/asc]   # default vendor/asc (.exe on Windows)
 *
 * Exit codes: 0 = clean, 1 = drift, missing engine or tooling error.
 * No third-party dependencies.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { engineSandbox } from './engine-env.mjs'
import { resolveAscPath } from './vendor-path.mjs'

const sandbox = engineSandbox()
process.on('exit', sandbox.cleanup)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Reviewed exceptions: command paths that mention a file-writing verb but are
 * legitimately reads. Keep empty unless a path is proven safe; every entry is a
 * deliberate decision to let a possible file write run without approval.
 */
const ALLOW_READ_FILE_WRITE = new Set([])

/**
 * Tokens that name a local-file write in `asc`'s command vocabulary. A path
 * containing one of these must never be classified as `read`.
 */
const FILE_WRITE_TOKENS = new Set(['download', 'export', 'save', 'capture', 'fetch', 'pull'])

/** Parse the bash array literal `_ASC_COMPLETION_PATHS=('a' 'b c' '')`. */
function parseCompletionPaths(script) {
  const marker = '_ASC_COMPLETION_PATHS=('
  const start = script.indexOf(marker)
  if (start === -1) throw new Error('completion script does not define _ASC_COMPLETION_PATHS')
  const end = script.indexOf(')\n', start)
  if (end === -1) throw new Error('could not find the end of _ASC_COMPLETION_PATHS')
  const body = script.slice(start + marker.length, end)
  const paths = []
  const quoted = /'((?:[^'\\]|\\.)*)'/g
  let match
  while ((match = quoted.exec(body)) !== null) {
    // Bash single-quoted strings: only `\'` and `\\` escapes appear in practice.
    paths.push((match[1] ?? '').replace(/\\(.)/g, '$1'))
  }
  return paths
}

function tokenize(path) {
  return path.split(' ').filter((token) => token.length > 0)
}

async function loadClassifier() {
  const lib = resolve(ROOT, 'lib/classify.js')
  if (!existsSync(lib)) {
    console.error('classify-audit: lib/classify.js is missing. Run `npm run build` first.')
    process.exit(1)
  }
  return import(pathToFileURL(lib).href)
}

async function main() {
  const ascPath = resolveAscPath(process.argv[2])
  if (!existsSync(ascPath)) {
    console.error(`classify-audit: ${ascPath} not found; install the target engine first.`)
    return 1
  }

  const { classifyArgv } = await loadClassifier()

  let script
  try {
    script = execFileSync(ascPath, ['completion', '--shell', 'bash'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sandbox.env,
      cwd: sandbox.directory,
      timeout: 30_000,
    })
  } catch (error) {
    console.error(`classify-audit: \`${ascPath} completion --shell bash\` failed: ${error.message}`)
    return 1
  }

  const paths = parseCompletionPaths(script)
  if (paths.filter(Boolean).length === 0) throw new Error('classify-audit: empty command catalog')
  const counts = { read: 0, 'local-write': 0, write: 0, forbidden: 0, unknown: 0 }
  const drift = []

  for (const path of paths) {
    const kind = classifyArgv(tokenize(path))
    counts[kind] += 1
    if (kind !== 'read') continue
    const writesFile = tokenize(path).some((token) => FILE_WRITE_TOKENS.has(token))
    if (writesFile && !ALLOW_READ_FILE_WRITE.has(path)) drift.push(path)
  }

  console.log(`classify-audit: ${ascPath}`)
  console.log(`  paths        ${paths.length}`)
  for (const [kind, count] of Object.entries(counts)) {
    console.log(`  ${kind.padEnd(12)} ${count}`)
  }

  // Completion paths omit flags: these reviewed vectors catch implicit file
  // writes and nested execution that a path-only drift gate cannot see.
  const vectors = [
    ['--report', 'junit', '--report-file', 'result.xml', 'apps', 'list'],
    ['doctor', '--fix=true'],
    ['doctor', '--fix', 'true'],
    ['xcode-cloud', 'doctor', '--save-logs', 'logs'],
    ['reviews', 'digest', '--state-file', 'status', '--write-state'],
    ['apps', 'registry', 'pull', '--path', 'status'],
    ['analytics', 'sales', '--output', 'report'],
    ['versions', 'phased-release', 'guard', '--dry-run', '--', 'status'],
  ]
  for (const argv of vectors) {
    if (classifyArgv(argv) === 'read') drift.push(argv.join(' '))
  }
  for (const argv of [
    ['--debug', 'false', 'web', 'apps', 'list'],
    ['--debug=false', 'auth', 'token'],
    ['versions', 'phased-release', 'guard', '--dry-run', '--', 'status'],
  ]) {
    if (classifyArgv(argv) !== 'forbidden') drift.push(`forbidden downgraded: ${argv.join(' ')}`)
  }
  console.log(`  flag vectors ${vectors.length + 3}`)

  if (drift.length > 0) {
    console.error(`\nFAIL: ${drift.length} file-writing path(s) classify as read (zero confirm, zero approval):`)
    for (const path of drift) console.error(`  - ${path || '(root)'}`)
    console.error(
      '\nFix src/classify.ts (FILE_WRITE_LEAVES) or add a reviewed entry to ALLOW_READ_FILE_WRITE in scripts/classify-audit.mjs.',
    )
    return 1
  }

  console.log('\nOK: no file-writing path classifies as read.')
  return 0
}

process.exitCode = await main()
