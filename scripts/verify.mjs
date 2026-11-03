#!/usr/bin/env node
/**
 * One-command quality gate: every check CI runs, in the order that fails
 * fastest. `typecheck → test → build → pack-manifest → contract-combos`, then
 * mandatory engine-backed `contract → classify-audit → smoke` checks.
 * Explicit --unit-only omits engine checks and reports that limitation.
 *
 * Usage: npm run verify   (or: node scripts/verify.mjs)
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const hasVendor = existsSync(resolve(root, 'vendor', 'asc'))
const unitOnly = process.argv.slice(2).includes('--unit-only')
if (process.argv.slice(2).some((arg) => arg !== '--unit-only')) throw new Error('Usage: npm run verify -- [--unit-only]')
if (!hasVendor && !unitOnly) {
  console.error('verify: vendor/asc is required for full verification. Build, run node scripts/download-asc.mjs, or explicitly use --unit-only.')
  process.exit(1)
}

/** @type {{ title: string, argv: string[], requires?: string }[]} */
const steps = [
  { title: 'typecheck', argv: [npm, 'run', 'typecheck'] },
  { title: 'test', argv: [npm, 'test'] },
  { title: 'build (clean + tsc)', argv: [npm, 'run', 'build'] },
  { title: 'pack manifest (lib/ == src/)', argv: [node, 'scripts/pack-manifest.mjs'] },
  { title: 'contract combinations (pre-approval argument guards)', argv: [node, 'scripts/contract-combos.mjs'] },
]

if (!unitOnly) {
  steps.push(
    { title: 'contract (registered commands accepted by asc)', argv: [node, 'scripts/contract.mjs', './vendor/asc'] },
    {
      title: 'classify audit (read/local-write drift)',
      argv: [node, 'scripts/classify-audit.mjs', './vendor/asc'],
      requires: 'scripts/classify-audit.mjs',
    },
    { title: 'smoke (runtime against the real binary)', argv: [node, 'scripts/smoke.mjs'] },
  )
} else {
  console.log('verify: explicit --unit-only; engine contract, classify-audit and smoke are NOT verified')
}

const seconds = (ms) => `${(ms / 1_000).toFixed(1)}s`

for (const step of steps) {
  if (step.requires !== undefined && !existsSync(resolve(root, step.requires))) {
    console.error(`\n=== ${step.title}`)
    console.error(`verify: FAILED — ${step.requires} is missing (required when vendor/asc exists)`)
    process.exit(1)
  }
  console.log(`\n=== ${step.title}`)
  console.log(`$ ${step.argv.join(' ')}`)
  const started = Date.now()
  try {
    execFileSync(step.argv[0], step.argv.slice(1), { cwd: root, stdio: 'inherit' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\nverify: FAILED at "${step.title}" after ${seconds(Date.now() - started)}`)
    console.error(message)
    process.exit(1)
  }
  console.log(`--- ${step.title}: ok (${seconds(Date.now() - started)})`)
}

console.log(`\nverify: all ${steps.length} step(s) passed`)
