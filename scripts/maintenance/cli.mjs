#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { discoverHarness, discoverTargets, downloadTarget, verifyHarness } from './discovery.mjs'
import { acquireLock, withLockOwner, readState, writeState, recover, mergeGate, prMarker, targetKey } from './state.mjs'
import { commonDirectory, runGit, syncCheckout } from './git.mjs'

const help = `Upstream maintenance helpers (Node 22/24; no GitHub mutations).

  node scripts/maintenance/cli.mjs discover --repository OWNER/REPO [--package-file package.json]
  node scripts/maintenance/cli.mjs harness-watch [--package-file package.json] [--lock-file package-lock.json]
  node scripts/maintenance/cli.mjs verify-harness --input target.json [--lock-file package-lock.json]
  node scripts/maintenance/cli.mjs download --input target.json --directory /existing/downloads
  node scripts/maintenance/cli.mjs marker --input target.json
  node scripts/maintenance/cli.mjs hold-lock --checkout /repo [--run-id ID] [--reclaim-dead]
  node scripts/maintenance/cli.mjs state --checkout /repo
  node scripts/maintenance/cli.mjs recover --checkout /repo --input github-snapshot.json
  node scripts/maintenance/cli.mjs record --checkout /repo --input state.json --lock-token TOKEN
  node scripts/maintenance/cli.mjs gate --input final-head-evidence.json
  node scripts/maintenance/cli.mjs sync --input sync-authorization.json [--lock-token TOKEN]

JSON inputs and examples: docs/MAINTENANCE.md. Relative paths resolve from cwd.
Discovery fixes exact versions/provenance; queries latest only, never alpha/next.
hold-lock stays alive until SIGINT/SIGTERM, prints the ownership token once.
record requires that live lock. sync acquires its own lock unless given its token.
No stale lock is reclaimed without --reclaim-dead AND a confirmed dead local PID.
Exit 0: success; 2: unknown/drift/blocked/pending; 1: invalid input or execution error.
The gate evaluates supplied facts; fresh GitHub verification is the operator's job.
`
const [command, ...args] = process.argv.slice(2)
const options = {}
const allowed = {
  discover: ['repository', 'package-file'], 'harness-watch': ['package-file', 'lock-file'],
  'verify-harness': ['input', 'lock-file'],
  download: ['input', 'directory'], marker: ['input'], 'hold-lock': ['checkout', 'run-id', 'reclaim-dead'],
  state: ['checkout'], recover: ['checkout', 'input'], record: ['checkout', 'input', 'lock-token'], gate: ['input'], sync: ['input', 'lock-token'],
}
function output(value) { console.log(JSON.stringify(value, null, 2)) }
async function json(path) { if (!path) throw new Error('Explicit input path required'); return JSON.parse(await readFile(resolve(path), 'utf8')) }
function required(name) { if (!options[name]) throw new Error(`--${name} is required`); return options[name] }
async function location() { return join(await commonDirectory(resolve(required('checkout'))), 'asc-maintenance', 'state.json') }

try {
  if (!command || command === '--help' || command === 'help') console.log(help)
  else {
    if (!allowed[command]) throw new Error('Unknown command; use --help')
    for (let index = 0; index < args.length; index++) {
      const name = args[index].replace(/^--/, '')
      if (!args[index].startsWith('--') || !allowed[command].includes(name) || options[name] !== undefined) throw new Error(`Unexpected or duplicate argument: ${args[index]}`)
      if (name === 'reclaim-dead') options[name] = true
      else {
        const value = args[++index]
        if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
        options[name] = value
      }
    }
    let result
    if (command === 'discover' || command === 'harness-watch') {
      const pkg = await json(options['package-file'] ?? 'package.json')
      const packageNames = Object.keys({ ...pkg.peerDependencies, ...pkg.devDependencies }).filter(name => name.startsWith('@deepseek-ai/'))
      if (command === 'discover') result = await discoverTargets({ repository: required('repository'), packageNames })
      else {
        result = await discoverHarness({ packageNames })
        if (result.status === 'discovered') {
          const lock = await json(options['lock-file'] ?? 'package-lock.json')
          const baseline = /^>=([^ ]+)/.exec(pkg.engines?.dsh ?? '')?.[1]
          const changes = []
          if (!baseline || baseline !== result.harness.version) changes.push({ name: '@deepseek-ai/dsh', installed: baseline ?? 'unknown', latest: result.harness.version })
          for (const item of result.harness.packages) {
            const installed = lock.packages?.[`node_modules/${item.name}`]?.version
            if (!installed || installed !== item.version) changes.push({ name: item.name, installed: installed ?? 'unknown', latest: item.version })
          }
          result = { ...result, status: changes.length ? 'drift' : 'unchanged', changes }
        }
      }
    } else if (command === 'verify-harness') {
      const input = await json(required('input'))
      const target = input.target ?? input
      targetKey(target)
      result = await verifyHarness(target.harness, { lock: options['lock-file'] ? await json(options['lock-file']) : undefined })
    } else if (command === 'download' || command === 'marker') {
      const input = await json(required('input'))
      const target = input.target ?? input
      targetKey(target)
      if (command === 'marker') result = { key: targetKey(target), marker: prMarker(target) }
      else result = await downloadTarget(target, { directory: resolve(required('directory')) })
    } else if (command === 'hold-lock') {
      const lock = await acquireLock({ commonDir: await commonDirectory(resolve(required('checkout'))), runId: options['run-id'] ?? randomUUID(), reclaimDead: options['reclaim-dead'] === true })
      if (lock.status !== 'acquired') result = lock
      else {
        output({ status: 'acquired', owner: lock.owner })
        await new Promise(resolveSignal => {
          const keepAlive = setInterval(() => {}, 60_000)
          const stop = () => { clearInterval(keepAlive); process.off('SIGINT', stop); process.off('SIGTERM', stop); resolveSignal() }
          process.on('SIGINT', stop)
          process.on('SIGTERM', stop)
        })
        result = await lock.release()
      }
    } else if (command === 'state') result = await readState(await location())
    else if (command === 'record') {
      const commonDir = await commonDirectory(resolve(required('checkout')))
      const state = await json(required('input'))
      result = await withLockOwner(commonDir, required('lock-token'), async () => {
        await writeState(join(commonDir, 'asc-maintenance', 'state.json'), state)
        return { status: 'recorded', key: state.key }
      })
    } else if (command === 'recover') {
      const snapshot = await json(required('input'))
      if (snapshot.complete !== true) throw new Error('Recovery requires a complete paginated PR snapshot')
      const loaded = await readState(await location())
      const refs = await runGit(resolve(required('checkout')), ['for-each-ref', '--format=%(refname:short)', 'refs/heads/maintenance/', 'refs/remotes/origin/maintenance/'])
      const branches = [...new Set(refs.split('\n').filter(Boolean).map(branch => branch.replace(/^origin\//, '')))]
      result = recover({ repository: snapshot.repository, prs: snapshot.prs, branches, state: loaded.state, syncedKeys: snapshot.syncedKeys ?? [] })
    } else if (command === 'gate') result = mergeGate(await json(required('input')))
    else if (command === 'sync') result = await syncCheckout({ ...await json(required('input')), lockToken: options['lock-token'] })
    output(result)
    if (result.allowed === false || ['unknown', 'drift', 'blocked', 'sync-pending', 'corrupt', 'missing'].includes(result.status)) process.exitCode = 2
  }
} catch (error) {
  // Input/network errors are useful, but subprocess errors can include credential-bearing remotes.
  output({ status: 'error', reason: error.code ? 'Filesystem or process operation failed; inspect local configuration' : error.message })
  process.exitCode = 1
}
