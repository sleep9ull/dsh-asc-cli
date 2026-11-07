import { execFileSync } from 'node:child_process'
import { readFile, writeFile, access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

describe('fixed minimum Harness support discovery', () => {
  it.each([
    { latest: '0.2.2-rc.1', versions: ['0.1.9', '0.2.0-rc.2', '0.2.0', '0.2.1', '0.2.2-rc.1'] },
    { latest: '0.2.9', versions: ['0.2.0-rc.2', '0.2.1', '0.2.8', '0.2.9'] },
    { latest: '0.3.0-rc.1', versions: ['0.1.9', '0.2.0-rc.2', '0.2.3', '0.3.0-rc.1'] },
    { latest: '1.0.0', versions: ['0.2.0-rc.2', '0.2.3', '1.0.0'] },
    { latest: '2.1.0-rc.1', versions: ['0.2.0-rc.2', '1.8.1', '2.0.4', '2.1.0-rc.1', '3.0.0-alpha.1'] },
  ])('keeps the exact minimum when default latest becomes $latest', async ({ latest, versions }) => {
    const net = artifactNetwork()
    const host = signedManifest('@deepseek-ai/dsh', latest, Buffer.from(`@deepseek-ai/dsh@${latest}`))
    net.manifests.set(host.name, host)
    net.tarballs.set(host.dist.tarball, Buffer.from(`@deepseek-ai/dsh@${latest}`))
    net.versions.splice(0, net.versions.length, ...versions)
    const found = await discoverHarness({ fetch: net.fetch, resolve: net.resolve })
    expect(found).toMatchObject({ status: 'discovered', harness: { version: latest } })
    expect(found.support).toEqual({ status: 'fixed-baseline', minimum: '0.2.0-rc.2', anchors: ['0.2.0-rc.2'] })
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    expect(compareBaseline(found.harness, { engines: { dsh: `0.2.0-rc.2 || ${latest}` } }, lockFor(), found.support)).toEqual([])
    expect(net.calls).toContain('https://registry.npmjs.org/%40deepseek-ai%2Fdsh')
    expect(net.calls.some(url => /\/(?:next|alpha)$/.test(url))).toBe(false)
  })
  it('keeps the fixed minimum when only prereleases are published and separates policy from target identity', async () => {
    const net = artifactNetwork()
    const versions = ['0.2.0-rc.2', '0.2.1-rc.5', '0.2.2-rc.1']
    const found = await discoverHarness({ fetch: net.fetch, resolve: net.resolve, versions })
    expect(found).toMatchObject({ status: 'discovered', support: { status: 'fixed-baseline', minimum: '0.2.0-rc.2', anchors: ['0.2.0-rc.2'] } })
    const { discoverTargets } = await import(modulePath + 'discovery.mjs')
    const result = await discoverTargets({ repository: 'owner/plugin', platform: 'linux', arch: 'x64', fetch: net.fetch, resolve: net.resolve, versions })
    expect(result.support).toEqual(found.support)
    expect(result.target).not.toHaveProperty('support')
    expect(result.target.harness).not.toHaveProperty('support')
  })
  it.each([
    ['0.2.0-rc.1', '0.2.1-rc.5'],
    ['0.1.9', '0.2.0', '0.2.1-rc.5', '0.2.3'],
  ])('reports an unavailable exact minimum instead of substituting published %j', async (...versions) => {
    const net = artifactNetwork()
    net.versions.splice(0, net.versions.length, ...versions)
    let resolved = false
    const found = await discoverHarness({ fetch: net.fetch, resolve: async () => { resolved = true; return net.resolve() } })
    expect(found).toMatchObject({ status: 'unknown', reason: expect.stringMatching(/minimum.*0\.2\.0-rc\.2/i) })
    expect(found).not.toHaveProperty('harness')
    expect(found).not.toHaveProperty('support')
    expect(resolved).toBe(false)
  })
  it('fails closed when full release records are unavailable', async () => {
    const net = artifactNetwork()
    const fetch = async (url: string, init?: RequestInit) => url === 'https://registry.npmjs.org/%40deepseek-ai%2Fdsh' ? Response.json({ error: 'unavailable' }, { status: 503 }) : net.fetch(url, init)
    const result = await discoverHarness({ fetch, resolve: net.resolve })
    expect(result.status).toBe('unknown')
    expect(result).not.toHaveProperty('harness')
    expect(result).not.toHaveProperty('support')
  })
})

describe('maintenance support CLI', () => {
  it.each([
    { command: 'harness-watch', supported: false, versions: ['0.2.0-rc.2', '0.1.9', '0.2.1', '0.2.2-rc.1'], status: 'drift', exit: 2 },
    { command: 'discover', supported: false, versions: ['0.2.0-rc.2', '0.2.2-rc.1'], status: 'discovered', exit: 0 },
    { command: 'harness-watch', supported: true, versions: ['0.2.0-rc.2', '0.1.9', '0.2.9', '0.2.2-rc.1'], status: 'unchanged', exit: 0 },
    { command: 'harness-watch', supported: true, versions: ['0.2.1-rc.5', '0.2.2-rc.1'], status: 'unknown', exit: 2 },
  ])('reports fixed minimum support from $command with published $versions', async ({ command, supported, versions, status, exit }) => {
    const directory = await mkdtemp(join(tmpdir(), 'asc-support-cli-'))
    try {
      const host = '0.2.2-rc.1'
      await writeFile(join(directory, 'package.json'), JSON.stringify({ engines: { dsh: `${supported ? '0.2.0-rc.2 || ' : ''}0.2.1-rc.5 || ${host}` } }))
      await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lockFor()))
      // Exercise the actual CLI with synthetic signed registry bytes and an injected npm resolver.
      const preload = `
        import childProcess from 'node:child_process'
        import { syncBuiltinESMExports } from 'node:module'
        import { writeFile } from 'node:fs/promises'
        import { join } from 'node:path'
        import { artifactNetwork, signedManifest } from ${JSON.stringify(new URL('./maintenance-fixtures.ts', import.meta.url).href)}
        const net = artifactNetwork()
        const bytes = Buffer.from('@deepseek-ai/dsh@${host}')
        const manifest = signedManifest('@deepseek-ai/dsh', '${host}', bytes)
        net.manifests.set(manifest.name, manifest)
        net.tarballs.set(manifest.dist.tarball, bytes)
        net.versions.splice(0, net.versions.length, ...${JSON.stringify(versions)})
        globalThis.fetch = net.fetch
        Object.defineProperty(process, 'platform', { value: 'linux' })
        Object.defineProperty(process, 'arch', { value: 'x64' })
        childProcess.execFile = (file, args, options, callback) => {
          if (file !== 'npm') throw new Error('Unexpected executable')
          net.resolve().then(lock => writeFile(join(options.cwd, 'package-lock.json'), JSON.stringify(lock))).then(() => callback(null, '', ''), callback)
        }
        syncBuiltinESMExports()
      `
      await writeFile(join(directory, 'preload.mjs'), preload)
      const cli = fileURLToPath(new URL('../scripts/maintenance/cli.mjs', import.meta.url))
      let stdout = '', code = 0
      try {
        stdout = execFileSync(process.execPath, ['--import', join(directory, 'preload.mjs'), cli, command, ...(command === 'discover' ? ['--repository', 'owner/plugin'] : [])], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        const failure = error as { status: number, stdout: string }
        code = failure.status
        stdout = failure.stdout
      }
      const result = JSON.parse(stdout)
      expect(code).toBe(exit)
      expect(result.status).toBe(status)
      if (status === 'unknown') {
        expect(result.reason).toMatch(/minimum.*0\.2\.0-rc\.2/i)
        expect(result).not.toHaveProperty('changes')
      } else {
        expect(result.changes).toEqual(supported ? [] : [
          { name: '@deepseek-ai/dsh', installed: 'unsupported', candidate: '0.2.0-rc.2', reason: 'minimum-baseline-required' },
        ])
        expect(result.support).toEqual({ status: 'fixed-baseline', minimum: '0.2.0-rc.2', anchors: ['0.2.0-rc.2'] })
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe('compatible baseline comparison and isolated resolution', () => {
  it.each(['0.2.0-rc.2 || 0.2.1-rc.5 || 0.2.2-rc.1', '0.2.2-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.5'])('uses the latest exact supported host as the development baseline: %s', async dsh => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const component = packageRecord('@deepseek-ai/cordis', '4.1.0')
    const pkg = { engines: { dsh }, peerDependencies: { [component.name]: '4.0.5 || 4.1.0' }, devDependencies: { [component.name]: '4.1.0' } }
    const harness = { ...packageRecord('@deepseek-ai/dsh', '0.2.2-rc.1'), packages: [component] }
    expect(compareBaseline(harness, pkg, lockFor(component))).toEqual([])
    expect(compareBaseline({ ...harness, version: '0.2.2-rc.2' }, pkg, lockFor(component))).toEqual([{ name: harness.name, installed: '0.2.2-rc.1', candidate: '0.2.2-rc.2' }])
    expect(() => compareBaseline({ ...harness, version: '0.2.1-rc.5' }, pkg, lockFor(component))).toThrow(/downgrade/)
  })
  it.each([
    { peer: '4.0.5 || 4.0.6', dev: '4.1.0' },
    { peer: '>=4.0.5 <5', dev: '4.1.0' },
    { peer: '4.0.5 || ^4.1.0', dev: '4.1.0' },
    { peer: '4.0.5 || 4.1.0', dev: '4.0.5 || 4.1.0' },
    { peer: '4.0.5 || 4.1.0', dev: '4.0.5' },
  ])('rejects invalid peer/dev declarations $peer / $dev', async ({ peer, dev }) => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const component = packageRecord('@deepseek-ai/cordis', '4.1.0')
    expect(() => compareBaseline({ ...packageRecord(), packages: [component] }, { engines: { dsh: '0.2.1-rc.5' }, peerDependencies: { [component.name]: peer }, devDependencies: { [component.name]: dev } }, lockFor(component))).toThrow(/pin|declaration/)
  })
  it.each([undefined, { status: 'fixed-baseline', minimum: '0.2.0-rc.2', anchors: ['0.2.0-rc.2'] }])('reports missing minimum support with unchanged development graph and support metadata %j', async support => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const host = { ...packageRecord('@deepseek-ai/dsh', '0.2.2-rc.1'), packages: [] }
    const pkg = { engines: { dsh: '0.2.1-rc.5 || 0.2.2-rc.1' } }
    expect(compareBaseline(host, pkg, lockFor(), support)).toEqual([
      { name: host.name, installed: 'unsupported', candidate: '0.2.0-rc.2', reason: 'minimum-baseline-required' },
    ])
    expect(compareBaseline(host, { engines: { dsh: '0.2.0-rc.2 || ' + pkg.engines.dsh } }, lockFor(), support)).toEqual([])
  })
  it('does not count a broad range as verified exact minimum support', async () => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const host = { ...packageRecord('@deepseek-ai/dsh', '0.2.0-rc.2'), packages: [] }
    expect(compareBaseline(host, { engines: { dsh: '>=0.2.0-rc.2' } }, lockFor())).toEqual([
      { name: host.name, installed: 'unsupported', candidate: '0.2.0-rc.2', reason: 'minimum-baseline-required' },
    ])
  })
  it.each(['0.2.0-rc.2 || 0.2.1-rc.5', '>=0.2.1-rc.5 <0.2.2-0'])('compares baseline %s and detects an actual compatible patch instead of excluded latest', async host => {
    const { compareBaseline } = await import(modulePath + 'compatibility.mjs')
    const pkg = { engines: { dsh: host }, peerDependencies: { '@deepseek-ai/cordis': '4.0.5' } }
    const selected = packageRecord('@deepseek-ai/cordis', '4.0.5')
    const baseline = { packages: { 'node_modules/@deepseek-ai/cordis': { version: selected.version, resolved: selected.tarball, integrity: selected.integrity } } }
    const current = { ...packageRecord(), packages: [selected] }
    const missingMinimum = host.startsWith('>=') ? [{ name: current.name, installed: 'unsupported', candidate: '0.2.0-rc.2', reason: 'minimum-baseline-required' }] : []
    expect(compareBaseline(current, pkg, baseline)).toEqual(missingMinimum)
    expect(compareBaseline({ ...current, packages: [packageRecord(selected.name, '4.0.6')] }, pkg, baseline)).toEqual([{ name: selected.name, installed: '4.0.5', candidate: '4.0.6' }, ...missingMinimum])
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
