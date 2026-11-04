import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
// Supported Node versions strip types, so discovery needs neither lib/ nor duplicated facts.
import { UPSTREAM_REPO, releaseAsset } from '../../src/compat.ts'

const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const commit = /^[a-f0-9]{40}$/i

async function get(url, fetchFn) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} while reading upstream metadata`)
  return response
}

function sourceUrl(value) {
  const url = new URL(String(value).replace(/^git\+/, '').replace(/\.git$/, ''))
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsupported source repository URL')
  return url.href
}

async function manifest(name, fetchFn) {
  if (!/^@deepseek-ai\/[a-z0-9-]+$/.test(name)) throw new Error('Invalid Harness package name')
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
  const data = await (await get(url, fetchFn)).json()
  if (data.name !== name || !exactVersion.test(data.version) || !commit.test(data.gitHead) || !data.dist?.integrity) {
    throw new Error(`Missing exact version or provenance for ${name}`)
  }
  return {
    name, version: data.version, manifestUrl: url, commit: data.gitHead,
    source: sourceUrl(typeof data.repository === 'string' ? data.repository : data.repository?.url),
    integrity: data.dist.integrity,
    // Dependency requirements are evidence, not a claim that independent latest packages interoperate.
    dependencies: Object.fromEntries(Object.entries({ ...data.dependencies, ...data.peerDependencies }).filter(([key, value]) => key.startsWith('@deepseek-ai/') && typeof value === 'string')),
  }
}

export async function discoverHarness({ packageNames = [], fetch: fetchFn = globalThis.fetch, now = Date.now } = {}) {
  try {
    const harness = await manifest('@deepseek-ai/dsh', fetchFn)
    const names = [...new Set(packageNames)].filter(name => name !== harness.name).sort()
    const packages = await Promise.all(names.map(name => manifest(name, fetchFn)))
    return { status: 'discovered', checkedAt: now(), harness: { ...harness, packages } }
  } catch (error) {
    return { status: 'unknown', checkedAt: now(), reason: error.message }
  }
}

export async function discoverTargets({ repository, packageNames = [], platform = process.platform, arch = process.arch, fetch: fetchFn = globalThis.fetch, now = Date.now } = {}) {
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Explicit owner/repository is required')
    const found = await discoverHarness({ packageNames, fetch: fetchFn, now })
    if (found.status !== 'discovered') return found
    const repo = UPSTREAM_REPO
    const api = `https://api.github.com/repos/${repo}`
    const release = await (await get(`${api}/releases/latest`, fetchFn)).json()
    const version = String(release.tag_name ?? '').replace(/^v/, '')
    if (!/^\d+\.\d+\.\d+$/.test(version) || release.draft !== false || release.prerelease !== false) throw new Error('Invalid stable asc release')
    const name = releaseAsset(version, platform, arch)
    if (name === undefined) throw new Error('Unsupported asc platform')
    const asset = release.assets?.find(item => item.name === name)
    const sums = release.assets?.find(item => item.name === `asc_${version}_checksums.txt`)
    const base = `https://github.com/${repo}/releases/download/${release.tag_name}/`
    if (asset?.browser_download_url !== base + name || sums?.browser_download_url !== base + sums?.name) throw new Error('Missing or unexpected release asset URLs')
    const resolved = await (await get(`${api}/commits/${encodeURIComponent(release.tag_name)}`, fetchFn)).json()
    if (!commit.test(resolved.sha)) throw new Error('Cannot resolve asc release source commit')
    const checksumText = await (await get(sums.browser_download_url, fetchFn)).text()
    const entries = checksumText.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line)).filter(match => match?.[2] === name)
    if (entries.length !== 1) throw new Error('Missing or ambiguous asc SHA-256')
    return { status: 'discovered', checkedAt: now(), target: {
      repository, harness: found.harness,
      asc: { version, tag: release.tag_name, commit: resolved.sha, source: `https://github.com/${repo}`, releaseUrl: `${api}/releases/tags/${encodeURIComponent(release.tag_name)}`, asset: name, assetUrl: asset.browser_download_url, checksumsUrl: sums.browser_download_url, sha256: entries[0][1].toLowerCase(), platform, arch },
    } }
  } catch (error) {
    return { status: 'unknown', checkedAt: now(), reason: error.message }
  }
}

/** Download only the pinned discovered artifact, never execute downloaded instructions. */
export async function downloadTarget(target, { directory, fetch: fetchFn = globalThis.fetch } = {}) {
  const asc = target.asc
  if (!directory || !/^[a-f0-9]{64}$/.test(asc?.sha256) || !/^asc_[\w.]+$/.test(asc?.asset)) throw new Error('Invalid pinned artifact')
  const source = new URL(asc.source)
  if (source.origin !== 'https://github.com' || source.username || source.password || asc.assetUrl !== `${asc.source}/releases/download/${asc.tag}/${asc.asset}`) throw new Error('Invalid pinned artifact URL')
  const staging = await mkdtemp(join(directory, 'asc-maintenance-'))
  const bytes = Buffer.from(await (await get(asc.assetUrl, fetchFn)).arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== asc.sha256) throw new Error('asc SHA-256 mismatch; nothing installed or executed')
  const path = join(staging, asc.asset)
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(path, 0o755)
  return { path, sha256: asc.sha256 }
}
