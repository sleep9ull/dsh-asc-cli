import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactNetwork, packageRecord, signedManifest } from './maintenance-fixtures.js'

const modulePath = '../scripts/maintenance/'
const { discoverHarness } = await import(modulePath + 'discovery.mjs')
type ResolutionLock = { lockfileVersion: number, packages: Record<string, { version?: string, resolved?: string, integrity?: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string> }> }
const lockFor = (...records: ReturnType<typeof packageRecord>[]): ResolutionLock => ({ lockfileVersion: 3, packages: {
  '': { dependencies: { '@deepseek-ai/dsh': '0.2.1-rc.5' } },
  ...Object.fromEntries(records.map(p => [`node_modules/${p.name}`, { version: p.version, resolved: p.tarball, integrity: p.integrity }])),
} })

function scenario(latestVersion: string, selectedVersion = '4.0.5') {
  const net = artifactNetwork()
  const selected = packageRecord('@deepseek-ai/cordis', selectedVersion)
  const latest = signedManifest(selected.name, latestVersion, Buffer.from(`${selected.name}@${latestVersion}`))
  const exact = signedManifest(selected.name, selectedVersion, Buffer.from(`${selected.name}@${selectedVersion}`))
  net.manifests.set(selected.name, latest)
  net.tarballs.set(latest.dist.tarball, Buffer.from(`${selected.name}@${latestVersion}`))
  net.tarballs.set(exact.dist.tarball, Buffer.from(`${selected.name}@${selectedVersion}`))
  const fetch = async (url: string, init?: RequestInit) => url === selected.manifestUrl ? Response.json(exact) : net.fetch(url, init)
  const lock = lockFor(packageRecord(), selected)
  return { net, fetch, lock, resolve: async () => lock }
}

describe('compatible Harness target selection', () => {
  it.each(['4.1.0', '4.0.1'])('keeps host-resolved 4.0.5 instead of independently tagged %s', async latest => {
    const s = scenario(latest)
    const found = await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: s.resolve })
    expect(found.status).toBe('discovered')
    expect(found.harness.packages[0].version).toBe('4.0.5')
    expect(found.observations).toMatchObject([{ name: '@deepseek-ai/cordis', version: latest, selected: '4.0.5' }])
  })
  it('still selects an independently versioned in-range patch from the complete host graph', async () => {
    const s = scenario('4.1.0', '4.0.6')
    const found = await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: s.resolve })
    expect(found.harness.packages[0].version).toBe('4.0.6')
  })
  it('does not claim compatibility when strict resolution detects a transitive peer conflict', async () => {
    const s = scenario('4.1.0')
    const found = await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: async () => { throw new Error('peer conflict') } })
    expect(found).toMatchObject({ status: 'unknown', reason: expect.stringContaining('peer conflict') })
  })
  it('rejects different host bytes in the resolver lock', async () => {
    const s = scenario('4.1.0')
    s.lock.packages['node_modules/@deepseek-ai/dsh']!.integrity = packageRecord('different-package').integrity
    expect((await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: s.resolve })).status).toBe('unknown')
  })
  it('rejects split shared components even if npm can place both versions', async () => {
    const s = scenario('4.1.0')
    Object.assign(s.lock.packages, { 'node_modules/another/node_modules/@deepseek-ai/cordis': { version: '4.1.0' } })
    expect((await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: s.resolve })).status).toBe('unknown')
  })
  it('rechecks fixed peer compatibility before allowing installation even when all signatures pass', async () => {
    const { verifyHarness } = await import(modulePath + 'npm-artifact.mjs')
    const net = artifactNetwork()
    const harness = { ...packageRecord(), dependencies: { '@deepseek-ai/cordis': '~4.0.5' }, packages: [packageRecord('@deepseek-ai/cordis', '4.0.5')] }
    const result = await verifyHarness(harness, { fetch: net.fetch, resolve: async () => { throw new Error('fixed peer conflict') } })
    expect(result).toMatchObject({ status: 'unknown', reason: expect.stringContaining('fixed peer conflict') })
  })
  it('does not suppress invalid signatures on excluded independent latest releases', async () => {
    const s = scenario('4.1.0')
    s.net.manifests.get('@deepseek-ai/cordis')!.dist.signatures = []
    expect((await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: s.resolve })).status).toBe('unknown')
  })
  it('rejects a selected package missing from the host graph rather than inventing a same-number version', async () => {
    const s = scenario('4.1.0')
    delete s.lock.packages['node_modules/@deepseek-ai/cordis']
    expect((await discoverHarness({ packageNames: ['@deepseek-ai/cordis'], fetch: s.fetch, resolve: s.resolve })).status).toBe('unknown')
  })
})

describe('compatible baseline comparison and isolated resolution', () => {
  it.each(['0.2.1-rc.5', '>=0.2.1-rc.5 <0.2.2-0'])('compares baseline %s and detects an actual compatible patch instead of excluded latest', async host => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const pkg = { engines: { dsh: host }, peerDependencies: { '@deepseek-ai/cordis': '4.0.5' } }
    const selected = packageRecord('@deepseek-ai/cordis', '4.0.5')
    const baseline = { packages: { 'node_modules/@deepseek-ai/cordis': { version: selected.version, resolved: selected.tarball, integrity: selected.integrity } } }
    const current = { ...packageRecord(), packages: [selected] }
    expect(compareBaseline(current, pkg, baseline)).toEqual([])
    expect(compareBaseline({ ...current, packages: [packageRecord(selected.name, '4.0.6')] }, pkg, baseline)).toMatchObject([{ name: selected.name, installed: '4.0.5', candidate: '4.0.6' }])
  })
  it('rejects an actual install lock with split shared instances even when fresh host resolution is clean', async () => {
    const { verifyHarness } = await import(modulePath + 'npm-artifact.mjs')
    const net = artifactNetwork()
    const component = packageRecord('@deepseek-ai/cordis', '4.0.5')
    const lock = lockFor(packageRecord(), component)
    lock.packages[''] = { devDependencies: { [component.name]: component.version } }
    lock.packages['node_modules/other/node_modules/@deepseek-ai/cordis'] = { version: '3.0.0' }
    const result = await verifyHarness({ ...packageRecord(), dependencies: { '@deepseek-ai/cordis': '~4.0.5' }, packages: [component] }, { fetch: net.fetch, resolve: net.resolve, lock })
    expect(result).toMatchObject({ status: 'unknown', reason: expect.stringMatching(/split shared/) })
  })
  it('rejects inconsistent product peer pins instead of reporting an unchanged dev lock', async () => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const component = packageRecord('@deepseek-ai/cordis', '4.0.5')
    const pkg = { engines: { dsh: '0.2.1-rc.5' }, peerDependencies: { [component.name]: '4.0.4' }, devDependencies: { [component.name]: '4.0.5' } }
    expect(() => compareBaseline({ ...packageRecord(), packages: [component] }, pkg, lockFor(component))).toThrow(/pin|declaration/i)
  })
  it('does not automatically downgrade a verified baseline when a default channel retreats', async () => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const selected = packageRecord('@deepseek-ai/cordis', '4.0.4')
    const pkg = { engines: { dsh: '>=0.2.1-rc.5 <0.2.2-0' } }
    expect(() => compareBaseline({ ...packageRecord(), packages: [selected] }, pkg, { packages: { 'node_modules/@deepseek-ai/cordis': { version: '4.0.5' } } })).toThrow(/regress|downgrade/i)
  })
  it('does not treat changed bytes at the same baseline version as unchanged', async () => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const selected = packageRecord('@deepseek-ai/cordis', '4.0.5')
    expect(() => compareBaseline({ ...packageRecord(), packages: [selected] }, { engines: { dsh: '>=0.2.1-rc.5' } }, { packages: { [`node_modules/${selected.name}`]: { version: selected.version, resolved: selected.tarball, integrity: 'tampered' } } })).toThrow(/identity|integrity|artifact/i)
  })
  it.each([false, true])('resolves a fixed target (%s) without scripts/user config and cleans its own temporary directory', async fixed => {
    const { resolveHost } = await import(modulePath + 'compatibility.mjs')
    const component = packageRecord('@deepseek-ai/cordis', '4.0.5')
    const host = { ...packageRecord(), ...(fixed ? { packages: [component] } : {}) }
    let directory = ''
    const run = async (_file: string, args: string[], opts: { cwd: string, env: Record<string, string> }) => {
      directory = opts.cwd
      expect(args).toEqual(expect.arrayContaining(['--package-lock-only', '--ignore-scripts', '--strict-peer-deps']))
      expect(args.join(' ')).not.toMatch(/--force|legacy-peer-deps/)
      expect(opts.env).not.toHaveProperty('ASC_PRIVATE_KEY')
      expect(opts.env).not.toHaveProperty('NPM_TOKEN')
      expect(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).dependencies).toEqual({ '@deepseek-ai/dsh': '0.2.1-rc.5', ...(fixed ? { '@deepseek-ai/cordis': '4.0.5' } : {}) })
      await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lockFor(packageRecord())))
    }
    await resolveHost(host, { run })
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
