/**
 * Contract test: every registered action must still be accepted by the
 * installed `asc` binary. Runs `asc <command> --help` (no network, no
 * credentials) and fails on a rejected command path or flag.
 *
 * Usage: node scripts/contract.mjs [path-to-asc]
 */

import { spawnSync } from 'node:child_process'
import { resolveAscPath } from './vendor-path.mjs'
import { allSpecs } from '../lib/registry.js'
import { engineSandbox } from './engine-env.mjs'

const sandbox = engineSandbox()
process.on('exit', sandbox.cleanup)
const spawnOptions = { encoding: 'utf8', env: sandbox.env, cwd: sandbox.directory, timeout: 30_000 }
const asc = resolveAscPath(process.argv[2])

const config = {
  ascPath: asc,
  mode: 'read-only',
  requireApproval: true,
  timeoutMs: 30_000,
  longTimeoutMs: 30_000,
  maxOutputBytes: 262_144,
  bypassKeychain: false,
  telemetryDisabled: true,
  env: {},
  defaultAppId: '123456789',
}

const args = {
  action: undefined,
  app: '123456789',
  buildId: 'BUILD_ID',
  buildNumber: '42',
  bundleId: 'com.example.app',
  copyMetadataFrom: '1.0.0',
  dir: './metadata',
  file: './App.ipa',
  group: 'Internal Testers',
  include: ['app', 'builds'],
  internal: true,
  ipa: './App.ipa',
  issueIds: ['app'],
  until: 'review-done',
  locale: 'en-US',
  name: 'Example',
  platform: 'IOS',
  query: 'upload a build',
  sort: '-createdDate',
  strict: true,
  submit: true,
  confirm: false,
  timeout: '30m',
  version: '1.2.3',
  wait: true,
}

const missing = spawnSync(asc, ['version'], spawnOptions)
if (missing.error !== undefined || missing.status !== 0) {
  console.error(`contract: cannot run ${asc}: ${missing.error?.message ?? missing.stderr}`)
  process.exit(1)
}
console.log(`contract: ${missing.stdout.trim()}`)

const failures = []
let checked = 0
const rootHelp = spawnSync(asc, ['--help'], spawnOptions)
if (rootHelp.error || rootHelp.status !== 0) throw new Error('contract: root help failed')
function flagsIn(text) {
  return new Set([...text.matchAll(/^\s+(--[\w-]+)(?=\s|$)/gm)].map((match) => match[1]))
}
const rootFlags = flagsIn(rootHelp.stdout + rootHelp.stderr)

function checkHelp(key, argv) {
  const command = argv.slice(0, argv.findIndex((token) => token.startsWith('-')) < 0
    ? argv.length : argv.findIndex((token) => token.startsWith('-')))
  const result = spawnSync(asc, ['--read-only', ...command, '--help'], spawnOptions)
  checked += 1
  if (result.error || result.status !== 0) {
    throw new Error(`${key}: command help failed: ${result.error?.message ?? result.stderr}`)
  }
  const declared = new Set([...rootFlags, ...flagsIn(result.stdout + result.stderr), '--help'])
  for (const token of argv) {
    if (token.startsWith('--') && !declared.has(token.split('=')[0])) {
      throw new Error(`${key}: ${token} is absent from upstream help`)
    }
  }
}

for (const spec of allSpecs()) {
  const key = spec.action ? `${spec.tool}.${spec.action}` : spec.tool
  let argv
  try {
    argv = spec.build({ ...args }, { config, cwd: process.cwd() })
  } catch (error) {
    failures.push({ key, reason: `argv builder failed: ${error.message}` })
    continue
  }
  try {
    checkHelp(key, argv)
  } catch (error) {
    failures.push({ key, reason: error.message })
  }
}

// These invocations are used by jobs/discovery outside the typed registry.
for (const argv of [
  ['search', '--limit', '3'],
  ['age-rating', 'view', '--app', args.app],
  ['encryption', 'declarations', 'list', '--app', args.app],
  ['accessibility', 'list', '--app', args.app],
  ['pricing', 'current', '--app', args.app],
]) {
  try { checkHelp(argv.slice(0, 2).join('.'), argv) }
  catch (error) { failures.push({ key: argv.join(' '), reason: error.message }) }
}
// A positive help exit alone does not validate flags: prove this gate rejects one.
let rejected = false
const positiveCount = checked
try { checkHelp('negative-control', ['apps', 'list', '--not-an-asc-flag']) }
catch { rejected = true }
checked = positiveCount
if (!rejected) failures.push({ key: 'negative-control', reason: 'unknown flag was accepted' })

if (failures.length > 0) {
  console.error(`\ncontract: ${failures.length} of ${checked} command(s) failed:`)
  for (const failure of failures) {
    console.error(`- ${failure.key}: ${failure.reason}`)
    if (failure.detail) console.error(`  ${failure.detail}`)
  }
  process.exit(1)
}

console.log(`contract: ${checked} command(s) accepted by asc`)
