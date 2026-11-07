import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions } from '../../src/compat.ts'
import { npmCommand } from '../npm-command.mjs'

export const MIN_HARNESS_VERSION = '0.2.0-rc.2'

const execute = promisify(execFile)

/** Resolve metadata only. No node_modules, lifecycle scripts, user config or shared cache. */
export async function resolveHost(harness, { run = execute } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'asc-host-resolution-'))
  try {
    const dependencies = { [harness.name]: harness.version, ...Object.fromEntries((harness.packages ?? []).map(pkg => [pkg.name, pkg.version])) }
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'asc-host-resolution', version: '1.0.0', private: true, dependencies }))
    await writeFile(join(directory, 'empty.npmrc'), '')
    const args = ['install', '--package-lock-only', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--fetch-retries=0', '--fetch-timeout=30000', `--cache=${join(directory, 'cache')}`, `--userconfig=${join(directory, 'empty.npmrc')}`, `--globalconfig=${join(directory, 'global.npmrc')}`]
    await writeFile(join(directory, 'global.npmrc'), '')
    const env = { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, NODE_OPTIONS: '--dns-result-order=ipv4first', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }
    try {
      const command = npmCommand(args)
      await run(command.file, command.args, { cwd: directory, env, timeout: 300_000, maxBuffer: 2 * 1024 * 1024 })
    } catch { throw new Error('Strict host dependency resolution failed; no compatible candidate selected (npm unavailable, peer conflict or registry failure)') }
    return JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export function assertResolved(pkg, entry) {
  if (!entry || entry.version !== pkg.version || entry.resolved !== pkg.tarball || entry.integrity !== pkg.integrity || entry.link) throw new Error(`Resolved artifact identity differs from verified package: ${pkg.name}`)
}

export function assertSharedPackages(lock) {
  if (!lock?.packages || typeof lock.packages !== 'object') throw new Error('Missing install dependency graph')
  const shared = new Map()
  for (const path of Object.keys(lock.packages)) {
    const name = /(?:^|\/)node_modules\/(@deepseek-ai\/[^/]+)$/.exec(path)?.[1]
    if (name) shared.set(name, (shared.get(name) ?? 0) + 1)
  }
  for (const [name, count] of shared) {
    if (count !== 1 || !lock.packages[`node_modules/${name}`] || lock.packages[`node_modules/${name}`].link) throw new Error(`Missing or split shared package in install graph: ${name}`)
  }
}

/** npm resolves the full dependency/peer graph; shared plugin packages must not split. */
export function selectPackages(lock, harness, names) {
  if (![2, 3].includes(lock?.lockfileVersion) || lock.packages?.['']?.dependencies?.[harness.name] !== harness.version) throw new Error('Missing exact host resolution graph')
  assertResolved(harness, lock.packages[`node_modules/${harness.name}`])
  assertSharedPackages(lock)
  return names.map(name => {
    const path = `node_modules/${name}`
    const entry = lock.packages[path]
    if (!entry?.version) throw new Error(`Missing shared package in host graph: ${name}`)
    return { ...entry, name }
  })
}

export function exactVersions(declaration) {
  if (typeof declaration !== 'string') return undefined
  const versions = declaration.split('||').map(value => value.trim())
  return versions.every(value => /^\d/.test(value) && Number.isFinite(compareVersions(value, value))) ? versions : undefined
}

export function compareBaseline(harness, pkg, lock) {
  const declaration = pkg.engines?.dsh ?? ''
  const supported = exactVersions(declaration)
  // Retain historical >= baseline declarations; only exact unions represent verified support.
  const baseline = supported?.slice().sort(compareVersions).at(-1) ?? (!declaration.includes('||') ? /^>=(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?: |$)/.exec(declaration)?.[1] : undefined)
  if (!baseline) throw new Error('Missing exact verified Harness baseline')
  assertSharedPackages(lock)
  const changes = []
  const compare = (name, installed, candidate) => {
    if (installed !== undefined) {
      const order = compareVersions(candidate, installed)
      if (!Number.isFinite(order)) throw new Error(`Invalid version comparison: ${name}`)
      if (order < 0) throw new Error(`Candidate would downgrade the verified baseline: ${name}`)
    }
    if (installed !== candidate) changes.push({ name, installed: installed ?? 'unknown', candidate })
  }
  compare(harness.name, baseline, harness.version)
  for (const item of harness.packages) {
    const entry = lock.packages?.[`node_modules/${item.name}`]
    for (const section of ['peerDependencies', 'devDependencies']) {
      const declaration = pkg[section]?.[item.name]
      if (declaration === undefined) continue
      const versions = exactVersions(declaration)
      if (!versions?.includes(entry?.version) || (section === 'devDependencies' && versions.length !== 1)) throw new Error(`Declared ${section} pin differs from verified baseline: ${item.name}`)
    }
    compare(item.name, entry?.version, item.version)
    if (entry?.version === item.version) assertResolved(item, entry)
  }
  // Minimum support is independent of development upgrades and discovery metadata.
  if (!supported?.includes(MIN_HARNESS_VERSION)) changes.push({ name: harness.name, installed: 'unsupported', candidate: MIN_HARNESS_VERSION, reason: 'minimum-baseline-required' })
  return changes
}
