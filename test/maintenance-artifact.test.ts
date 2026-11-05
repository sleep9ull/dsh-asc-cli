import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactNetwork, packageRecord, registryKey, signedManifest } from './maintenance-fixtures.js'

const modulePath = '../scripts/maintenance/'
const discovery = await import(modulePath + 'discovery.mjs')
const { targetKey, prMarker, parseMarker, recover, writeState, readState, mergeGate } = await import(modulePath + 'state.mjs')
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const target = () => ({ repository: 'owner/plugin', harness: { ...packageRecord(), dependencies: { '@deepseek-ai/cordis': '~4.0.5' }, packages: [packageRecord('@deepseek-ai/cordis', '4.0.5')] }, asc: { version: '6.4.0', commit: 'a'.repeat(40), sha256: 'b'.repeat(64) } })

describe('npm maintenance artifact verification', () => {
  it('discovers signed bytes without gitHead and pins each package independently', async () => {
    const net = artifactNetwork()
    const fetch = async (url: string, init?: RequestInit) => {
      if (!url.endsWith('.tgz') && url.startsWith('https://registry.npmjs.org/')) {
        expect(init?.headers).toMatchObject({ Accept: 'application/json' })
      }
      return net.fetch(url, init)
    }
    const result = await discovery.discoverTargets({ repository: 'owner/plugin', packageNames: ['@deepseek-ai/cordis'], platform: 'linux', arch: 'x64', fetch })
    expect(result.status).toBe('discovered')
    expect(result.target.harness).toMatchObject({ commit: null, integrity: packageRecord().integrity, verification: { kind: 'npm-registry-signature', keyid: registryKey.keyid } })
    expect(result.target.harness.packages[0]).toMatchObject({ name: '@deepseek-ai/cordis', version: '4.0.5', commit: null })
    expect(result.target.harness.manifestUrl).toBe('https://registry.npmjs.org/%40deepseek-ai%2Fdsh/0.2.1-rc.5')
    expect(net.calls).toContain(packageRecord().tarball)
    expect(net.calls.filter(url => url.endsWith('/-/npm/v1/keys'))).toHaveLength(1)
    expect(net.calls.some(url => /alpha|next/.test(url))).toBe(false)
  })

  it.each(['bytes', 'signature', 'unsigned', 'unknown-key', 'expired-key', 'bad-key', 'missing-integrity', 'malformed-integrity', 'bad-commit', 'wrong-name', 'wrong-version'] as const)('refuses %s instead of accepting a claimed digest or signature', async failure => {
    const net = artifactNetwork()
    const m = net.manifests.get('@deepseek-ai/dsh')!
    if (failure === 'bytes') net.tarballs.set(m.dist.tarball, Buffer.from('tampered'))
    if (failure === 'signature') m.dist.signatures[0]!.sig = signedManifest(m.name, m.version, Buffer.from('another artifact')).dist.signatures[0]!.sig
    if (failure === 'unsigned') m.dist.signatures = []
    if (failure === 'unknown-key') net.keys.splice(0)
    if (failure === 'expired-key') net.keys[0]!.expires = '2000-01-01T00:00:00Z'
    if (failure === 'bad-key') net.keys[0]!.key = 'invalid'
    if (failure === 'missing-integrity') m.dist.integrity = ''
    if (failure === 'malformed-integrity') m.dist.integrity = 'sha512-example'
    if (failure === 'bad-commit') m.gitHead = 'not-a-commit'
    if (failure === 'wrong-name') m.name = '@deepseek-ai/dsh-tools'
    if (failure === 'wrong-version') m.version = '0.2.2'
    const result = await discovery.discoverHarness({ fetch: net.fetch })
    expect(result.status).toBe('unknown')
    expect(result.harness).toBeUndefined()
  })

  it.each([
    'https://evil.example/dsh.tgz',
    'http://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz',
    'https://user:password@registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz',
    'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz?redirect=1',
    'https://registry.npmjs.org/@deepseek-ai/cordis/-/cordis-4.0.5.tgz',
  ])('refuses a tarball URL outside the pinned identity: %s', async url => {
    const net = artifactNetwork()
    net.manifests.get('@deepseek-ai/dsh')!.dist.tarball = url
    expect((await discovery.discoverHarness({ fetch: net.fetch })).status).toBe('unknown')
    expect(net.calls).not.toContain(url)
  })

  it('refuses an unrelated claimed source repository before fetching its artifact', async () => {
    const net = artifactNetwork()
    const manifest = net.manifests.get('@deepseek-ai/dsh')!
    manifest.repository.url = 'https://github.com/other/project'
    expect((await discovery.discoverHarness({ fetch: net.fetch })).status).toBe('unknown')
    expect(net.calls).not.toContain(manifest.dist.tarball)
  })

  it.each(['redirect', 'too-large'] as const)('refuses %s responses during the actual byte check', async failure => {
    const net = artifactNetwork()
    const fetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith('.tgz')) {
        expect(init?.redirect).toBe('error')
        const r = new Response('untrusted', failure === 'too-large' ? { headers: { 'content-length': String(1024 ** 3) } } : undefined)
        if (failure === 'redirect') Object.defineProperty(r, 'redirected', { value: true })
        return r
      }
      return net.fetch(url, init)
    }
    expect((await discovery.discoverHarness({ fetch })).status).toBe('unknown')
  })

  it('accepts a valid signature among rotated or malformed signatures, without treating gitHead as construction proof', async () => {
    const net = artifactNetwork()
    const manifest = net.manifests.get('@deepseek-ai/dsh')!
    manifest.gitHead = 'a'.repeat(40)
    manifest.dist.signatures.unshift({ keyid: 'unknown', sig: 'invalid' })
    const found = await discovery.discoverHarness({ fetch: net.fetch })
    expect(found.status).toBe('discovered')
    expect(found.harness.commit).toBe(manifest.gitHead)
    expect(found.harness.verification.kind).toBe('npm-registry-signature')
  })

  it('re-verifies pinned bytes and the lockfile without consulting latest', async () => {
    const net = artifactNetwork()
    const t = target()
    const pkg = t.harness.packages[0]!
    const lock = { packages: { '': { devDependencies: { [pkg.name]: pkg.version } }, [`node_modules/${pkg.name}`]: { version: pkg.version, integrity: pkg.integrity, resolved: pkg.tarball } } }
    expect(await discovery.verifyHarness(t.harness, { fetch: net.fetch, lock })).toMatchObject({ status: 'verified', packages: 2 })
    expect(net.calls.some(url => url.endsWith('/latest'))).toBe(false)
    net.tarballs.set(t.harness.tarball, Buffer.from('changed after discovery'))
    expect((await discovery.verifyHarness(t.harness, { fetch: net.fetch, lock })).status).toBe('unknown')
  })

  it.each(['version', 'integrity', 'resolved', 'missing'] as const)('blocks lockfile %s drift before installation', async failure => {
    const net = artifactNetwork()
    const t = target()
    const pkg = t.harness.packages[0]!
    const entry = { version: pkg.version, integrity: pkg.integrity, resolved: pkg.tarball }
    if (failure !== 'missing') entry[failure] = 'different'
    const lock = { packages: { '': { devDependencies: { [pkg.name]: pkg.version } }, ...(failure === 'missing' ? {} : { [`node_modules/${pkg.name}`]: entry }) } }
    expect((await discovery.verifyHarness(t.harness, { fetch: net.fetch, lock })).status).toBe('unknown')
  })

  it('rejects a fixed target omitting a direct Harness dependency declared by the install lock', async () => {
    const net = artifactNetwork()
    const t = target()
    t.harness.packages = []
    const pkg = packageRecord('@deepseek-ai/cordis', '4.0.5')
    const lock = { packages: { '': { devDependencies: { [pkg.name]: pkg.version } }, [`node_modules/${pkg.name}`]: { version: pkg.version, integrity: pkg.integrity, resolved: pkg.tarball } } }
    expect((await discovery.verifyHarness(t.harness, { fetch: net.fetch, lock })).status).toBe('unknown')
  })

  it('keeps the pinned signing identity valid when another valid key is listed first', async () => {
    const net = artifactNetwork()
    const second = signedManifest('@deepseek-ai/dsh', '0.2.1-rc.5', Buffer.from('@deepseek-ai/dsh@0.2.1-rc.5'), true)
    net.keys.unshift(second.key!)
    net.manifests.get('@deepseek-ai/dsh')!.dist.signatures.unshift(second.dist.signatures[0]!)
    expect(await discovery.verifyHarness(target().harness, { fetch: net.fetch })).toMatchObject({ status: 'verified' })
  })

  it('rejects same-version metadata drift and does not trust a supplied verification field', async () => {
    const net = artifactNetwork()
    const t = target()
    const next = signedManifest('@deepseek-ai/dsh', t.harness.version, Buffer.from('replacement'))
    net.manifests.set(next.name, next)
    net.tarballs.set(next.dist.tarball, Buffer.from('replacement'))
    expect((await discovery.verifyHarness(t.harness, { fetch: net.fetch })).status).toBe('unknown')
  })
})

describe('artifact maintenance records', () => {
  it('round-trips v3 records, preserves repair history and refuses fixed artifact drift', async () => {
    const t = target()
    const key = targetKey(t)
    const body = prMarker(t)
    expect(body).toContain('asc-maintenance:v3')
    expect(parseMarker(body).target.harness.commit).toBeNull()
    const dir = await mkdtemp(join(tmpdir(), 'npm-record-')); dirs.push(dir)
    const path = join(dir, 'state.json')
    const state = { status: 'awaiting-checks', target: t, key, branch: 'maintenance/artifact', repairAttempts: 2 }
    await writeState(path, state)
    const loaded = await readState(path)
    const pr = { number: 3, state: 'OPEN', body, headRefName: state.branch }
    expect(recover({ repository: t.repository, prs: [pr], state: loaded.state })).toMatchObject({ status: 'pr-open', repairAttempts: 2, target: t })
    const changed = structuredClone(t)
    changed.harness.integrity = 'sha512-' + createHash('sha512').update('replacement').digest('base64')
    await expect(writeState(path, { ...state, target: changed })).rejects.toThrow('provenance')
    expect(JSON.parse(await readFile(path, 'utf8')).target.harness.integrity).toBe(t.harness.integrity)
  })

  it('keeps v2 history visible but blocks unfinished records pending explicit migration', () => {
    const old = { repository: 'owner/plugin', harness: { version: '0.2.1-rc.5', commit: 'a'.repeat(40), integrity: 'sha512-legacy', packages: [] }, asc: { version: '6.4.0', commit: 'a'.repeat(40), sha256: 'b'.repeat(64) } }
    const key = targetKey(old)
    const body = `<!-- asc-maintenance:v2 ${Buffer.from(JSON.stringify({ key, target: old })).toString('base64url')} -->`
    const pr = { number: 1, state: 'OPEN', body, headRefName: 'maintenance/old' }
    const state = { status: 'awaiting-checks', target: old, key, branch: pr.headRefName, repairAttempts: 1 }
    expect(recover({ repository: old.repository, prs: [pr], state })).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/v2|migrat/i) })
    expect(recover({ repository: old.repository, prs: [{ ...pr, state: 'MERGED', mergeCommit: { oid: 'a'.repeat(40) } }], state, syncedKeys: [key] }).status).toBe('idle')
    expect(() => prMarker(old)).toThrow()
    expect(mergeGate({ target: old }).allowed).toBe(false)
    expect(() => parseMarker(body + prMarker(target()))).toThrow()
  })
})
