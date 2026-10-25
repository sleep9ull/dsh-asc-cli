#!/usr/bin/env node
/**
 * Plugin-side negative contract: every illegal parameter combination must be
 * rejected by the argv builder before spawn (no asc binary required).
 *
 * Complements `contract.mjs` (upstream --help) and `classify-audit.mjs`
 * (completion drift). Run after `npm run build`.
 */

import { specFor } from '../lib/registry.js'

const config = {
  ascPath: 'asc',
  mode: 'write',
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
  checkUpdates: true,
  env: {},
  defaultAppId: '111',
}
const ctx = { config, cwd: process.cwd() }

const reject = [
  ['asc_apply.upload', { file: 'App.ipa', wait: true, dryRun: true }, /dry-run.*wait|wait.*dry-run/i],
  ['asc_apply.upload', { file: 'App.pkg' }, /version.*build-number|build-number.*version/i],
  ['asc_apply.upload', { file: 'App.pkg', version: '1.0.0' }, /build-number/i],
  ['asc_apply.groups', { group: 'G', submit: true, dryRun: true }, /dry-run.*submit|submit.*dry-run/i],
  ['asc_apply.stage', { version: '1.2.3', buildId: 'B' }, /metadata/i],
  ['asc_apply.stage', { version: '1.2.3', buildId: 'B', metadataDir: 'm', copyMetadataFrom: '1.0.0' }, /metadata/i],
  ['asc_apply.stage', { buildId: 'B', metadataDir: 'm' }, /version/i],
  ['asc_apply.publish', { app: '111', version: '1.0.0' }, /ipa.*pkg|pkg.*ipa/i],
  ['asc_apply.publish', { app: '111', version: '1.0.0', ipa: 'a.ipa', pkg: 'a.pkg' }, /ipa.*pkg|pkg.*ipa/i],
  ['asc_apply.publish', { app: '111', pkg: 'a.pkg' }, /version|build-number/i],
  ['asc_apply.publish', { app: '111', pkg: 'a.pkg', version: '1.0.0' }, /build-number/i],
  ['asc.testflight-groups', { app: '111', internal: true, external: true }, /internal.*external|external.*internal/i],
]

const accept = [
  ['asc_apply.upload', { file: 'App.ipa' }],
  ['asc_apply.upload', { file: 'App.pkg', version: '1.0.0', buildNumber: '7' }],
  ['asc_apply.groups', { group: 'G', buildId: 'B' }],
  ['asc_apply.groups', { group: 'G' }],
  ['asc_apply.stage', { version: '1.2.3', buildId: 'B', metadataDir: 'm' }],
  ['asc_apply.publish', { app: '111', ipa: 'a.ipa' }],
  ['asc_apply.publish', { app: '111', pkg: 'a.pkg', version: '1.0.0', buildNumber: '7' }],
  ['asc.testflight-groups', { app: '111', internal: true }],
]

let failed = 0
for (const [key, args, pattern] of reject) {
  const [tool, action] = key.split('.')
  const spec = specFor(tool, action)
  try {
    spec.build({ ...args }, ctx)
    console.error(`FAIL ${key} ${JSON.stringify(args)} was accepted; expected rejection (${pattern})`)
    failed += 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pattern.test(message)) {
      console.error(`FAIL ${key} rejected with unexpected message: ${message}`)
      failed += 1
    }
  }
}
for (const [key, args] of accept) {
  const [tool, action] = key.split('.')
  const spec = specFor(tool, action)
  try {
    const argv = spec.build({ ...args }, ctx)
    console.log(`ok   ${key} -> ${argv.join(' ')}`)
  } catch (error) {
    console.error(`FAIL ${key} rejected a legal call: ${error instanceof Error ? error.message : String(error)}`)
    failed += 1
  }
}
if (failed > 0) {
  console.error(`\ncontract-combos: ${failed} failure(s)`)
  process.exit(1)
}
console.log(`contract-combos: ${reject.length} illegal combination(s) rejected, ${accept.length} legal call(s) accepted`)
