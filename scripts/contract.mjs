/**
 * Contract test: every registered action must still be accepted by the
 * installed `asc` binary. Runs `asc <command> --help` (no network, no
 * credentials) and fails on a rejected command path or flag.
 *
 * Usage: node scripts/contract.mjs [path-to-asc]
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { allSpecs } from '../lib/registry.js'

const asc = resolve(process.argv[2] ?? 'vendor/asc')

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

const missing = spawnSync(asc, ['version'], { encoding: 'utf8' })
if (missing.error !== undefined || missing.status !== 0) {
  console.error(`contract: cannot run ${asc}: ${missing.error?.message ?? missing.stderr}`)
  process.exit(1)
}
console.log(`contract: ${missing.stdout.trim()}`)

const failures = []
let checked = 0

for (const spec of allSpecs()) {
  const key = spec.action ? `${spec.tool}.${spec.action}` : spec.tool
  let argv
  try {
    argv = spec.build({ ...args }, { config, cwd: process.cwd() })
  } catch (error) {
    failures.push({ key, reason: `argv builder failed: ${error.message}` })
    continue
  }
  const full = [asc, '--read-only', ...argv, '--help']
  const result = spawnSync(full[0], full.slice(1), { encoding: 'utf8' })
  checked += 1
  if (result.status !== 0) {
    failures.push({
      key,
      reason: `asc ${argv.join(' ')} --help exited ${result.status}`,
      detail: (result.stderr || result.stdout).trim().split('\n').slice(0, 3).join(' | '),
    })
  }
}

if (failures.length > 0) {
  console.error(`\ncontract: ${failures.length} of ${checked} command(s) failed:`)
  for (const failure of failures) {
    console.error(`- ${failure.key}: ${failure.reason}`)
    if (failure.detail) console.error(`  ${failure.detail}`)
  }
  process.exit(1)
}

console.log(`contract: ${checked} command(s) accepted by asc`)
