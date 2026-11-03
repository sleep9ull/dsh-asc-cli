#!/usr/bin/env node
/** Offline engine smoke through the real Harness rc.5 subprocess provider. */
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAscPath } from './vendor-path.mjs'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createEngine } from '../lib/control/engine.js'
import { createRuntime } from '../lib/runtime.js'
import { PINNED_ASC_VERSION } from '../lib/compat.js'
import { decideCall } from '../lib/approval.js'
import { execAsc } from '../lib/exec.js'
import { engineSandbox } from './engine-env.mjs'

const asc = resolveAscPath(process.argv[2])
assert.ok(existsSync(asc), `Engine missing: ${asc}`)
const sandbox = engineSandbox()
const ctx = new Context()
await ctx.plugin(LocalSubprocessRuntime)
let spawns = 0
const spawn = (spec) => {
  spawns += 1
  return ctx.subprocess.spawn(spec)
}
const config = {
  ascPath: asc,
  mode: 'read-only',
  requireApproval: true,
  timeoutMs: 30_000,
  longTimeoutMs: 30_000,
  maxOutputBytes: 262_144,
  maxDataBytes: 32_000,
  bypassKeychain: true,
  telemetryDisabled: true,
  allowValueExpansion: false,
  unknownCommands: 'ask',
  allowProvision: false,
  approvedActions: [],
  checkUpdates: false,
  workdir: sandbox.directory,
  env: sandbox.env,
}
const runtime = createRuntime(ctx, config, spawn)
const exec = { signal: new AbortController().signal }

try {
  const forwarded = {
    ASC_KEY_ID: 'smoke-key', ASC_ISSUER_ID: 'smoke-issuer',
    ASC_PRIVATE_KEY_PATH: '/synthetic/AuthKey.p8', ASC_PRIVATE_KEY: 'synthetic-key-material',
  }
  const envCheck = await execAsc({ ...config, ascPath: process.execPath, mode: 'write', env: { ...sandbox.env, ...forwarded } }, {
    argv: ['-e', `console.log(JSON.stringify({keys:Object.fromEntries(${JSON.stringify(Object.keys(forwarded))}.map(k=>[k,process.env[k]])),readOnly:process.env.ASC_READ_ONLY,web:process.env.ASC_WEB_SESSION}))`],
    cwd: sandbox.directory, timeoutMs: 30_000, maxBytes: 4_096, appendOutput: false,
  }, spawn)
  assert.equal(envCheck.ok, true, envCheck.stderr)
  assert.deepEqual(envCheck.data, { keys: forwarded }, 'real subprocess must forward explicit canaries and honor tombstones')

  const version = await createEngine(config, spawn).version()
  // upstream-watch deliberately runs a newer release through the same smoke.
  if (!process.argv.includes('--latest')) assert.equal(version, PINNED_ASC_VERSION)
  else assert.match(version ?? '', /^\d+\.\d+\.\d+$/)
  const search = await runtime.runArgv(['search', '--limit', '3', 'upload a build'], { confirm: false }, exec)
  assert.equal(search.ok, true, search.summary)
  assert.ok(search.data && typeof search.data === 'object', 'search must return structured data')

  for (const argv of [
    ['--debug', 'false', 'web', 'apps', 'list'],
    ['versions', 'phased-release', 'guard', '--dry-run', '--', 'status'],
    ['builds', 'upload', '--app', '123', '--ipa', 'App.ipa'],
    ['doctor', '--fix=true'],
  ]) {
    const before = spawns
    await assert.rejects(runtime.runArgv(argv, { confirm: false }, exec))
    assert.equal(spawns, before, 'rejected calls must not spawn')
  }

  const directory = join(sandbox.directory, 'metadata')
  const args = { dir: directory, confirm: true }
  assert.equal(decideCall(config, 'asc_apply', { action: 'metadata-init', ...args })?.kind, 'ask')
  // This local fixture write is explicitly authorized by the smoke invocation;
  // real host approval routing is exercised separately in harness.test.ts.
  const initialized = await runtime.runAction('asc_apply', 'metadata-init', args, exec)
  assert.equal(initialized.ok, true, initialized.summary)
  const incomplete = await runtime.runAction('asc', 'metadata-validate', { dir: directory }, exec)
  assert.equal(incomplete.ok, false, 'an empty scaffold must fail metadata validation')
  assert.equal(incomplete.data?.valid, false)
  writeFileSync(join(directory, 'app-info/en-US.json'), JSON.stringify({ name: 'Offline Smoke' }))
  const validated = await runtime.runAction('asc', 'metadata-validate', { dir: directory }, exec)
  assert.equal(validated.ok, true, validated.summary)
  assert.equal(validated.data?.valid, true)
  console.log(`smoke: asc ${version}; search, metadata init/validate, and four pre-spawn refusals passed`)
  console.log(`smoke: ${spawns} calls through the real Harness subprocess provider; isolated HOME and no real credentials`)
} finally {
  await ctx.fiber.dispose()
  sandbox.cleanup()
}
