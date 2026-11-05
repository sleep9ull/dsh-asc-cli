import { createHash, createPublicKey, verify } from 'node:crypto'
import { resolveHost, selectPackages, assertResolved, assertSharedPackages } from './compatibility.mjs'

const registry = 'https://registry.npmjs.org'
const source = 'https://github.com/deepseek-ai/deepseek-harness'
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const keyId = /^SHA256:[A-Za-z0-9+/]{43}=?$/
const commit = /^[a-f0-9]{40}$/i
const metadataLimit = 2 * 1024 * 1024
const artifactLimit = 64 * 1024 * 1024

export function manifestUrl(name, version = 'latest') {
  if (!/^@deepseek-ai\/[a-z0-9-]+$/.test(name) || (version !== 'latest' && !exactVersion.test(version))) throw new Error('Invalid npm package identity')
  return `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
}
function tarballUrl(name, version) {
  return `${registry}/${name}/-/${name.split('/')[1]}-${version}.tgz`
}
function sha512(integrity) {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity)
  if (!match || Buffer.from(match[1], 'base64').toString('base64') !== match[1]) throw new Error('Missing or malformed npm SHA-512 integrity')
  return match[1]
}
function declaredSource(value) {
  const url = String(typeof value === 'string' ? value : value?.url).replace(/^git\+/, '').replace(/\.git$/, '')
  if (url !== source) throw new Error('Unexpected Harness source repository')
  return url
}

/** Shape checks do not establish trust: verifyHarness must perform the network/byte checks again. */
export function assertPackageRecord(pkg) {
  if (!pkg || pkg.manifestUrl !== manifestUrl(pkg.name, pkg.version) || pkg.version === 'latest' || pkg.tarball !== tarballUrl(pkg.name, pkg.version) || pkg.source !== source) throw new Error('Unexpected pinned npm artifact identity')
  sha512(pkg.integrity)
  if (pkg.commit !== null && !commit.test(pkg.commit)) throw new Error('Malformed declared npm gitHead')
  if (pkg.verification?.kind !== 'npm-registry-signature' || !keyId.test(pkg.verification.keyid) || Object.keys(pkg.verification).some(key => !['kind', 'keyid'].includes(key))) throw new Error('Missing npm registry signature verification record')
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object' || Array.isArray(pkg.dependencies) || Object.entries(pkg.dependencies).some(([name, value]) => !/^@deepseek-ai\/[a-z0-9-]+$/.test(name) || typeof value !== 'string')) throw new Error('Invalid Harness dependency requirements')
}

async function bytes(url, fetchFn, limit, accept = 'application/octet-stream') {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000), redirect: 'error', headers: { Accept: accept } })
  if (!response.ok || response.redirected) throw new Error('Failed or redirected npm registry request')
  const declared = response.headers.get('content-length')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty npm registry response')
  let length = 0
  const chunks = []
  try {
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('npm registry response exceeds size limit')
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) throw new Error('npm registry response exceeds size limit')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, length)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}
export async function npmJson(url, fetchFn) {
  return JSON.parse((await bytes(url, fetchFn, metadataLimit, 'application/json')).toString('utf8'))
}
export async function registryKeys(fetchFn) {
  const document = await npmJson(`${registry}/-/npm/v1/keys`, fetchFn)
  if (!Array.isArray(document.keys)) throw new Error('Missing official npm registry keys')
  return document.keys
}
function signatureKey(manifest, keys, now, pinnedKeyid) {
  const payload = Buffer.from(`${manifest.name}@${manifest.version}:${manifest.dist.integrity}`)
  for (const signature of manifest.dist.signatures ?? []) {
    if (pinnedKeyid && signature?.keyid !== pinnedKeyid) continue
    if (!signature || !keyId.test(signature.keyid) || typeof signature.sig !== 'string' || !/^[A-Za-z0-9+/]{1,512}={0,2}$/.test(signature.sig)) continue
    for (const key of keys.filter(key => key?.keyid === signature.keyid)) {
      try {
        if (key.scheme !== 'ecdsa-sha2-nistp256' || key.keytype !== 'ecdsa-sha2-nistp256') continue
        if (key.expires !== null && (!Number.isFinite(Date.parse(key.expires)) || Date.parse(key.expires) <= now())) continue
        const publicKey = createPublicKey({ key: Buffer.from(key.key, 'base64'), format: 'der', type: 'spki' })
        if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') continue
        if (verify('sha256', payload, publicKey, Buffer.from(signature.sig, 'base64'))) return signature.keyid
      } catch { /* A malformed/rotated signature cannot hide another valid registry signature. */ }
    }
  }
  throw new Error(`No valid unexpired npm registry signature for ${manifest.name}`)
}
function record(manifest, name) {
  if (manifest.name !== name || !exactVersion.test(manifest.version)) throw new Error('Unexpected npm package name or exact version')
  if (manifest.gitHead !== undefined && manifest.gitHead !== null && !commit.test(manifest.gitHead)) throw new Error('Malformed declared npm gitHead')
  const pkg = {
    name, version: manifest.version, manifestUrl: manifestUrl(name, manifest.version),
    commit: manifest.gitHead ?? null, source: declaredSource(manifest.repository),
    integrity: manifest.dist?.integrity, tarball: manifest.dist?.tarball,
    dependencies: Object.fromEntries(Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies }).filter(([name, value]) => name.startsWith('@deepseek-ai/') && typeof value === 'string')),
  }
  if (pkg.tarball !== tarballUrl(name, pkg.version)) throw new Error('Unexpected npm tarball URL')
  sha512(pkg.integrity)
  return pkg
}
async function checkArtifact(pkg, manifest, { fetch, keys, now, pinnedKeyid }) {
  const keyid = signatureKey(manifest, keys, now, pinnedKeyid)
  const content = await bytes(pkg.tarball, fetch, artifactLimit)
  if (createHash('sha512').update(content).digest('base64') !== sha512(pkg.integrity)) throw new Error(`npm SHA-512 mismatch for ${pkg.name}`)
  return { ...pkg, verification: { kind: 'npm-registry-signature', keyid } }
}
export async function discoverPackage(name, { fetch, keys, now }, version = 'latest') {
  const manifest = await npmJson(manifestUrl(name, version), fetch)
  if (version !== 'latest' && manifest.version !== version) throw new Error('Exact npm package version differs from resolution')
  return checkArtifact(record(manifest, name), manifest, { fetch, keys, now })
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
function lockMatches(pkg, lock, required) {
  const entry = lock?.packages?.[`node_modules/${pkg.name}`]
  if (!entry && !required) return
  if (!entry || entry.version !== pkg.version || entry.integrity !== pkg.integrity || entry.resolved !== pkg.tarball) throw new Error(`Lockfile differs from pinned npm artifact: ${pkg.name}`)
}

/** Re-fetch exact manifests and bytes; saved verification fields alone never qualify an artifact. */
export async function verifyHarness(harness, { fetch: fetchFn = globalThis.fetch, now = Date.now, lock, resolve = resolveHost } = {}) {
  try {
    if (harness?.name !== '@deepseek-ai/dsh' || !Array.isArray(harness.packages)) throw new Error('Missing fixed Harness target')
    const packages = [harness, ...harness.packages]
    if (new Set(packages.map(pkg => pkg.name)).size !== packages.length) throw new Error('Duplicate npm artifact identity')
    let declared
    if (lock !== undefined) {
      assertSharedPackages(lock)
      const root = lock?.packages?.['']
      if (!root || typeof root !== 'object') throw new Error('Install lockfile has no root dependency declarations')
      declared = new Set(Object.keys({ ...root.peerDependencies, ...root.devDependencies }).filter(name => name.startsWith('@deepseek-ai/')))
      const fixed = new Set(packages.slice(1).map(pkg => pkg.name))
      const required = new Set([...declared].filter(name => name !== '@deepseek-ai/dsh'))
      if (fixed.size !== required.size || [...required].some(name => !fixed.has(name))) throw new Error('Fixed target does not cover the install lockfile Harness dependencies')
    }
    for (const pkg of packages) {
      assertPackageRecord(pkg)
      if (lock !== undefined) lockMatches(pkg, lock, pkg !== harness || declared.has(pkg.name))
    }
    const keys = await registryKeys(fetchFn)
    for (const pkg of packages) {
      const manifest = await npmJson(pkg.manifestUrl, fetchFn)
      const found = record(manifest, pkg.name)
      const pinned = { ...pkg }; delete pinned.packages; delete pinned.verification
      if (JSON.stringify(canonical(found)) !== JSON.stringify(canonical(pinned))) throw new Error(`Pinned npm artifact metadata changed: ${pkg.name}`)
      await checkArtifact(found, manifest, { fetch: fetchFn, keys, now, pinnedKeyid: pkg.verification.keyid })
    }
    // Pin every selected package during re-resolution; later releases cannot replace this target.
    const graph = await resolve(harness)
    const selected = selectPackages(graph, harness, harness.packages.map(pkg => pkg.name))
    for (const [index, entry] of selected.entries()) assertResolved(harness.packages[index], entry)
    return { status: 'verified', validation: 'artifacts-and-dependency-resolution-only', packages: packages.length, checkedAt: now() }
  } catch (error) { return { status: 'unknown', checkedAt: now(), reason: error.message } }
}
