import { createHash, generateKeyPairSync, sign } from 'node:crypto'

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
export const registryKey = { keyid: 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, ''), keytype: 'ecdsa-sha2-nistp256', scheme: 'ecdsa-sha2-nistp256', key: publicKey.toString('base64'), expires: null as string | null }
export type Manifest = {
  name: string, version: string, gitHead?: string,
  repository: { url: string }, dependencies: Record<string, string>,
  dist: { integrity: string, tarball: string, signatures: { keyid: string, sig: string }[] },
}
export function signedManifest(name: string, version: string, bytes: Buffer, alternateKey = false): Manifest & { key?: typeof registryKey } {
  const signingPair = alternateKey ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : pair
  const der = signingPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const key = { ...registryKey, keyid: 'SHA256:' + createHash('sha256').update(der).digest('base64').replace(/=+$/, ''), key: der.toString('base64') }
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  const leaf = name.split('/')[1]!
  const sig = sign('sha256', Buffer.from(`${name}@${version}:${integrity}`), signingPair.privateKey).toString('base64')
  return { name, version, key: alternateKey ? key : undefined, repository: { url: 'git+https://github.com/deepseek-ai/deepseek-harness.git' }, dependencies: {}, dist: { integrity, tarball: `https://registry.npmjs.org/${name}/-/${leaf}-${version}.tgz`, signatures: [{ keyid: key.keyid, sig }] } }
}
export function packageRecord(name = '@deepseek-ai/dsh', version = '0.2.1-rc.5') {
  const manifest = signedManifest(name, version, Buffer.from(`${name}@${version}`))
  return { name, version, commit: null, source: 'https://github.com/deepseek-ai/deepseek-harness', manifestUrl: `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, tarball: manifest.dist.tarball, integrity: manifest.dist.integrity, verification: { kind: 'npm-registry-signature', keyid: registryKey.keyid }, dependencies: {} }
}
export function artifactNetwork() {
  const calls: string[] = []
  const names = [['@deepseek-ai/dsh', '0.2.1-rc.5'], ['@deepseek-ai/cordis', '4.0.5']] as const
  const manifests = new Map<string, Manifest>()
  const tarballs = new Map<string, Buffer>()
  for (const [name, version] of names) {
    const bytes = Buffer.from(`${name}@${version}`)
    const manifest = signedManifest(name, version, bytes)
    if (name.endsWith('/dsh')) manifest.dependencies = { '@deepseek-ai/cordis': '~4.0.5' }
    manifests.set(name, manifest)
    tarballs.set(manifest.dist.tarball, bytes)
  }
  const keys = [{ ...registryKey }]
  const versions: string[] = ['0.2.1-rc.5']
  const fetch = async (url: string, _init?: RequestInit) => {
    calls.push(url)
    if (url === 'https://registry.npmjs.org/-/npm/v1/keys') return Response.json({ keys })
    if (url === 'https://registry.npmjs.org/%40deepseek-ai%2Fdsh') return Response.json({ name: '@deepseek-ai/dsh', versions: Object.fromEntries(versions.map(version => [version, {}])), 'dist-tags': { next: '99.0.0-alpha.1', alpha: '99.0.0-alpha.2' } })
    if (tarballs.has(url)) return new Response(new Uint8Array(tarballs.get(url)!))
    for (const [name, manifest] of manifests) {
      const base = `https://registry.npmjs.org/${encodeURIComponent(name)}/`
      if (url === base + 'latest' || url === base + manifest.version) return Response.json(manifest)
    }
    if (url.endsWith('/releases/latest')) return Response.json({ tag_name: '6.4.0', draft: false, prerelease: false, assets: [{ name: 'asc_6.4.0_linux_amd64', browser_download_url: 'https://github.com/rorkai/App-Store-Connect-CLI/releases/download/6.4.0/asc_6.4.0_linux_amd64' }, { name: 'asc_6.4.0_checksums.txt', browser_download_url: 'https://github.com/rorkai/App-Store-Connect-CLI/releases/download/6.4.0/asc_6.4.0_checksums.txt' }] })
    if (url.includes('/commits/')) return Response.json({ sha: 'a'.repeat(40) })
    if (url.endsWith('checksums.txt')) return new Response(`${'b'.repeat(64)}  asc_6.4.0_linux_amd64\n`)
    throw new Error(`Unexpected URL: ${url}`)
  }
  const resolve = async () => ({ lockfileVersion: 3, packages: {
    '': { dependencies: { '@deepseek-ai/dsh': manifests.get('@deepseek-ai/dsh')!.version } },
    ...Object.fromEntries([...manifests.values()].map(m => [`node_modules/${m.name}`, { version: m.version, integrity: m.dist.integrity, resolved: m.dist.tarball }])),
  } })
  return { calls, manifests, tarballs, keys, versions, fetch, resolve }
}
