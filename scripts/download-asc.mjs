#!/usr/bin/env node
/** Download a reproducible engine baseline, or latest for the drift watcher. */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PINNED_ASC_VERSION, UPSTREAM_LATEST_URL,
  checksumsUrl, parseChecksums, releaseAsset, releaseUrl,
} from '../lib/compat.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const latest = process.argv.slice(2).includes('--latest')
const unexpected = process.argv.slice(2).filter((arg) => arg !== '--latest')
if (unexpected.length) throw new Error(`Unknown arguments: ${unexpected.join(' ')}`)

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`)
  return response
}

let version = PINNED_ASC_VERSION
if (latest) {
  const release = await (await get(UPSTREAM_LATEST_URL)).json()
  version = String(release.tag_name ?? '').replace(/^v/, '')
}
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`)
const asset = releaseAsset(version)
if (!asset) throw new Error(`No asc release for ${process.platform}-${process.arch}`)
const sums = parseChecksums(await (await get(checksumsUrl(version))).text())
const expected = sums.get(asset)
if (!expected) throw new Error(`Checksum missing for ${asset}`)

const vendor = join(root, 'vendor')
await mkdir(vendor, { recursive: true })
// Keep downloaded material separate from the scripts that consume it.
const staging = await mkdtemp(join(vendor, '.asc-download-'))
try {
  const bytes = Buffer.from(await (await get(releaseUrl(asset, version))).arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== expected) throw new Error(`SHA-256 mismatch for ${asset}`)
  const binary = join(staging, asset)
  await writeFile(binary, bytes, { mode: 0o600 })
  await chmod(binary, 0o755)
  const target = join(vendor, 'asc')
  // Read an existing target before replacing it; matching contents need no write.
  const existing = await readFile(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (!existing || createHash('sha256').update(existing).digest('hex') !== digest) {
    await rename(binary, target)
  } else {
    await chmod(target, 0o755)
  }
  console.log(`asc ${version}: ${asset}, SHA-256 ${digest}`)
  console.log(`Installed ${target}${latest ? ' (latest drift target)' : ' (compat baseline)'}`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
