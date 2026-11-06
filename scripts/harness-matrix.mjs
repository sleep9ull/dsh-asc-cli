#!/usr/bin/env node
/** Verify one packed plugin against every declared, independently locked host. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyHarness } from './maintenance/npm-artifact.mjs'
import { compareVersions } from '../src/compat.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--asc')) throw new Error('Usage: node scripts/harness-matrix.mjs [--asc /verified/asc]')
const asc = args[1] === undefined ? undefined : resolve(args[1])
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const directory = await mkdtemp(join(tmpdir(), 'asc-retained-host-'))
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
try {
  const pkg = await readJson(join(root, 'package.json'))
  const matrix = await readJson(join(root, 'test/fixtures/harness-support.json'))
  const supported = pkg.engines.dsh.split('||').map(version => version.trim()).sort(compareVersions)
  if (supported.some(version => !Number.isFinite(compareVersions(version, version))) || new Set(supported).size !== supported.length || matrix.development !== supported.at(-1) || !Array.isArray(matrix.retained)) throw new Error('Invalid declared host matrix')
  const fixtureName = name => typeof name === 'string' && /^[a-zA-Z0-9.-]+\.json$/.test(name)
  const rows = []
  for (const row of matrix.retained) {
    if (![row.target, row.lock].every(fixtureName)) throw new Error('Invalid retained fixture path')
    rows.push({ harness: await readJson(join(root, 'test/fixtures', row.target)), lock: await readJson(join(root, 'test/fixtures', row.lock)) })
  }
  const retained = rows.map(row => row.harness.version).sort(compareVersions)
  if (new Set(retained).size !== retained.length || JSON.stringify(retained) !== JSON.stringify(supported.filter(version => version !== matrix.development))) throw new Error('Retained fixtures must cover every declared host other than the development host')
  if (!fixtureName(matrix.developmentTarget)) throw new Error('Invalid development target fixture')
  const developmentTarget = await readJson(join(root, 'test/fixtures', matrix.developmentTarget))
  if (developmentTarget.version !== matrix.development) throw new Error('Development target must match the declared host')
  rows.push({ harness: developmentTarget, lock: await readJson(join(root, 'package-lock.json')) })
  const environment = home => ({
    PATH: process.env.PATH, HOME: home, USERPROFILE: home,
    NODE_OPTIONS: '--dns-result-order=ipv4first', ASC_HARNESS_BUILT: '1',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  })
  const run = (file, argv, cwd, home, capture = false) => execFileSync(file, argv, {
    cwd, env: environment(home), timeout: 300_000, maxBuffer: 4 * 1024 * 1024,
    stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8',
  })
  await writeFile(join(directory, 'empty.npmrc'), '')
  await writeFile(join(directory, 'global.npmrc'), '')
  const configs = [`--userconfig=${join(directory, 'empty.npmrc')}`, `--globalconfig=${join(directory, 'global.npmrc')}`]
  // No lifecycle scripts: every consumer installs exactly the same compiled artifact.
  const packed = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', directory, ...configs, `--cache=${join(directory, 'pack-cache')}`], root, directory, true))
  if (packed.length !== 1 || !packed[0].filename || packed[0].name !== pkg.name) throw new Error('Unexpected package artifact')
  for (const { harness, lock } of rows) {
    const checkout = join(directory, harness.version)
    await mkdir(checkout)
    await cp(join(directory, packed[0].filename), join(checkout, 'plugin.tgz'))
    const development = Object.fromEntries(Object.entries(pkg.devDependencies).map(([name, version]) => [name, name.startsWith('@deepseek-ai/') ? lock.packages[`node_modules/${name}`]?.version : version]))
    if (Object.values(development).some(version => typeof version !== 'string')) throw new Error('Retained lock does not cover development dependencies')
    const consumer = {
      name: 'asc-retained-host-verification', version: '1.0.0', private: true, type: 'module',
      dependencies: { [pkg.name]: 'file:plugin.tgz' }, devDependencies: development,
      scripts: pkg.scripts, engines: { node: pkg.engines.node },
    }
    lock.name = consumer.name
    lock.version = consumer.version
    lock.packages[''] = { name: consumer.name, version: consumer.version, dependencies: consumer.dependencies, devDependencies: development, engines: consumer.engines }
    await writeFile(join(checkout, 'package.json'), JSON.stringify(consumer, null, 2) + '\n')
    await writeFile(join(checkout, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
    for (const name of ['src', 'test', 'scripts', 'skills', 'dev', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE']) {
      await cp(join(root, name), join(checkout, name), { recursive: true })
    }
    const npmOptions = ['--ignore-scripts', '--strict-peer-deps', '--include=dev', '--include=optional', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--fetch-retries=0', '--fetch-timeout=30000', `--cache=${join(checkout, 'cache')}`, ...configs]
    run(npm, ['install', '--package-lock-only', ...npmOptions], checkout, checkout)
    const verification = await verifyHarness(harness, { lock: await readJson(join(checkout, 'package-lock.json')) })
    if (verification.status !== 'verified') throw new Error(JSON.stringify(verification))
    console.log(`harness-matrix: verified ${verification.packages} fixed artifacts for ${harness.version}; package ${pkg.name}@${pkg.version}, ${packed[0].integrity}`)
    const before = await readFile(join(checkout, 'package-lock.json'), 'utf8')
    run(npm, ['ci', ...npmOptions], checkout, checkout)
    if (await readFile(join(checkout, 'package-lock.json'), 'utf8') !== before) throw new Error('Installation changed the verified lock')
    run(npm, ['run', 'verify', '--', '--unit-only'], checkout, checkout)
    if (asc !== undefined) {
      // The source build must not substitute a different artifact in smoke.
      await rm(join(checkout, 'lib'), { recursive: true, force: true })
      await cp(join(checkout, 'node_modules', pkg.name, 'lib'), join(checkout, 'lib'), { recursive: true })
      run(process.execPath, ['scripts/smoke.mjs', asc, '--latest'], checkout, checkout)
    }
    console.log(`harness-matrix: host ${harness.version} passed using package integrity ${packed[0].integrity}`)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
