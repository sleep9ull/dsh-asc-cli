import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// The production helpers are native ESM developer scripts, outside the plugin build.
const modulePath = '../scripts/maintenance/'
const { discoverTargets, discoverHarness, downloadTarget } = await import(modulePath + 'discovery.mjs')
const { acquireLock, readState, writeState, targetKey, prMarker, recover, mergeGate } = await import(modulePath + 'state.mjs')
const { syncCheckout, commonDirectory, runGit } = await import(modulePath + 'git.mjs')
const dirs: string[] = []
async function temp() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'maintenance-')))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const sha = 'a'.repeat(40)
const checksum = 'b'.repeat(64)
const target = { repository: 'owner/plugin', harness: { version: '0.2.1-rc.5', commit: sha, integrity: 'sha512-example', packages: [] }, asc: { version: '6.4.0', commit: sha, sha256: checksum } }
const key = () => targetKey(target)

function network(fail = false) {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    if (fail) throw new Error('offline')
    if (url.includes('registry.npmjs.org')) {
      const name = url.includes('cordis') ? '@deepseek-ai/cordis' : '@deepseek-ai/dsh'
      const version = name.endsWith('cordis') ? '4.0.5' : '0.2.1-rc.5'
      const manifest = { name, version, gitHead: sha, repository: { url: 'git+https://github.com/deepseek-ai/harness.git' }, dist: { integrity: 'sha512-example', tarball: 'https://registry.npmjs.org/example.tgz' }, dependencies: name.endsWith('dsh') ? { '@deepseek-ai/cordis': '~4.0.5' } : {} }
      return Response.json(url.endsWith('/latest') ? manifest : { 'dist-tags': { latest: version, alpha: '9.0.0-alpha.1' }, versions: { [version]: manifest } })
    }
    if (url.endsWith('/releases/latest')) return Response.json({ tag_name: '6.4.0', draft: false, prerelease: false, assets: [{ name: 'asc_6.4.0_linux_amd64', browser_download_url: 'https://github.com/rorkai/App-Store-Connect-CLI/releases/download/6.4.0/asc_6.4.0_linux_amd64' }, { name: 'asc_6.4.0_checksums.txt', browser_download_url: 'https://github.com/rorkai/App-Store-Connect-CLI/releases/download/6.4.0/asc_6.4.0_checksums.txt' }] })
    if (url.includes('/commits/')) return Response.json({ sha })
    if (url.endsWith('checksums.txt')) return new Response(`${checksum}  asc_6.4.0_linux_amd64\n`)
    throw new Error(`Unexpected URL: ${url}`)
  }
  return { fetch, calls }
}

describe('maintenance discovery', () => {
  it('pins default rc and independently versioned packages, ignoring alpha', async () => {
    const net = network()
    const found = await discoverTargets({ repository: 'owner/plugin', packageNames: ['@deepseek-ai/cordis'], platform: 'linux', arch: 'x64', fetch: net.fetch, now: () => 42 })
    expect(found.status).toBe('discovered')
    expect(found.target.harness.version).toBe('0.2.1-rc.5')
    expect(found.target.harness.packages[0].version).toBe('4.0.5')
    expect(found.target.asc).toMatchObject({ version: '6.4.0', commit: sha, sha256: checksum })
    expect(net.calls.some(url => url.includes('alpha'))).toBe(false)
  })
  it('downloads the pinned asset into isolation only after matching its checksum', async () => {
    const directory = await temp()
    const bytes = 'synthetic binary fixture, never executed'
    const found = await discoverTargets({ repository: 'owner/plugin', platform: 'linux', arch: 'x64', fetch: network().fetch })
    found.target.asc.sha256 = createHash('sha256').update(bytes).digest('hex')
    const result = await downloadTarget(found.target, { directory, fetch: async () => new Response(bytes) })
    expect(await readFile(result.path, 'utf8')).toBe(bytes)
    await expect(downloadTarget(found.target, { directory, fetch: async () => new Response('tampered') })).rejects.toThrow('SHA-256')
    const artifacts = (await Promise.all((await readdir(directory)).map(entry => readdir(join(directory, entry))))).flat()
    expect(artifacts).toEqual(['asc_6.4.0_linux_amd64'])
  })
  it('reports unknown on network or absent provenance, never unchanged', async () => {
    expect((await discoverTargets({ repository: 'owner/plugin', fetch: network(true).fetch })).status).toBe('unknown')
    const result = await discoverHarness({ fetch: async () => Response.json({ name: '@deepseek-ai/dsh', version: '1.0.0', dist: { integrity: 'sha512-example' } }) })
    expect(result.status).toBe('unknown')
  })
})

describe('maintenance recovery and lock', () => {
  it('retains repair history across recovery and blocks unknown histories', () => {
    const branch = 'maintenance/one'
    const pr = { number: 3, state: 'OPEN', body: prMarker(target), headRefName: branch }
    const state = { status: 'awaiting-checks', key: key(), target, branch, repairAttempts: 2 }
    const recovered = recover({ repository: target.repository, prs: [pr], branches: [branch], state })
    expect(recovered).toMatchObject({ status: 'pr-open', repairAttempts: 2 })
    expect(recover({ repository: target.repository, prs: [pr], state: recovered })).toMatchObject({ repairAttempts: 2 })
    const unknown = recover({ repository: target.repository, prs: [pr] })
    expect(unknown).toMatchObject({ status: 'blocked', key: key(), target, repairAttempts: null })
  })
  it('starts a new target for an independent package release after sync', async () => {
    const pkg = { name: '@deepseek-ai/cordis', version: '4.0.5', commit: sha, integrity: 'sha512-first' }
    const previous = { ...target, harness: { ...target.harness, packages: [pkg] } }
    const next = { ...target, harness: { ...target.harness, packages: [{ ...pkg, version: '4.0.6', integrity: 'sha512-next' }] } }
    const path = join(await temp(), 'state.json')
    await writeState(path, { status: 'synced', key: targetKey(previous), target: previous })
    const state = { status: 'adapting', key: targetKey(next), target: next, branch: 'maintenance/next', repairAttempts: 0 }
    await writeState(path, state)
    const prs = [
      { number: 3, state: 'MERGED', body: prMarker(previous), headRefName: 'maintenance/previous', mergeCommit: { oid: sha } },
      { number: 4, state: 'OPEN', body: prMarker(next), headRefName: state.branch },
    ]
    expect(recover({ repository: target.repository, prs, state, branches: prs.map(pr => pr.headRefName), syncedKeys: [targetKey(previous)] })).toMatchObject({ status: 'pr-open', target: next })
    const second = { ...pkg, name: '@deepseek-ai/dsh-tools' }
    expect(targetKey({ ...target, harness: { ...target.harness, packages: [pkg, second] } })).toBe(targetKey({ ...target, harness: { ...target.harness, packages: [second, pkg] } }))
  })
  it('blocks orphan branches and other unfinished local targets before selecting a PR', () => {
    const branch = 'maintenance/one'
    const pr = { number: 3, state: 'OPEN', body: prMarker(target), headRefName: branch }
    const state = { status: 'awaiting-checks', key: key(), target, branch, repairAttempts: 0 }
    expect(recover({ repository: target.repository, prs: [pr], state, branches: [branch, 'maintenance/orphan'] }).status).toBe('blocked')
    const other = { ...target, asc: { ...target.asc, version: '6.5.0' } }
    expect(recover({ repository: target.repository, prs: [pr], branches: [branch, 'maintenance/other'], state: { ...state, status: 'adapting', target: other, key: targetKey(other), branch: 'maintenance/other' } }).status).toBe('blocked')
    expect(recover({ repository: target.repository, prs: [], branches: [branch, 'maintenance/orphan'], state: { ...state, status: 'adapting' } }).status).toBe('blocked')
  })
  it('does not silently ignore legacy target markers', () => {
    const legacyKey = createHash('sha256').update(JSON.stringify([target.repository, target.harness.version, target.asc.version])).digest('hex')
    const body = `<!-- asc-maintenance:v1 ${Buffer.from(JSON.stringify({ key: legacyKey, target })).toString('base64url')} -->`
    expect(recover({ repository: target.repository, prs: [{ number: 3, state: 'OPEN', headRefName: 'maintenance/old', body }] })).toMatchObject({ status: 'blocked', reason: expect.stringContaining('v1') })
  })
  it('serializes contenders across worktrees and does not expire a live owner', async () => {
    const directory = await temp()
    const options = { commonDir: directory, runId: 'first', now: () => 1 }
    const first = await acquireLock(options)
    expect(first.status).toBe('acquired')
    const contenders = await Promise.all([acquireLock({ ...options, runId: 'second', now: () => 9999999999999, reclaimDead: true }), acquireLock({ ...options, runId: 'third' })])
    expect(contenders.every(item => item.status === 'blocked')).toBe(true)
    await first.release()
    const next = await acquireLock({ ...options, runId: 'next' })
    expect(next.status).toBe('acquired')
    await next.release()
  })
  it('requires confirmed dead process and explicit reclamation, never TTL alone', async () => {
    const directory = await temp()
    await acquireLock({ commonDir: directory, runId: 'dead', pid: 999999, now: () => 1 })
    expect((await acquireLock({ commonDir: directory, runId: 'uncertain', ownerAlive: () => undefined, reclaimDead: true })).status).toBe('blocked')
    expect((await acquireLock({ commonDir: directory, runId: 'no-reclaim', ownerAlive: () => false })).status).toBe('blocked')
    const recovered = await acquireLock({ commonDir: directory, runId: 'recovered', ownerAlive: () => false, reclaimDead: true })
    expect(recovered.status).toBe('acquired')
    await recovered.release()
  })
  it('reconstructs after merged-before-save and refuses duplicate/closed PRs', () => {
    const pr = { number: 3, state: 'MERGED', body: prMarker(target), headRefName: 'maintenance/one', mergeCommit: { oid: sha } }
    expect(recover({ repository: target.repository, prs: [pr], branches: [] })).toMatchObject({ status: 'sync-pending', mergeCommit: sha, target })
    expect(recover({ repository: target.repository, prs: [{ ...pr, state: 'CLOSED' }], branches: [] }).status).toBe('blocked')
    expect(recover({ repository: target.repository, prs: [pr, { ...pr, number: 4 }], branches: [] }).status).toBe('blocked')
  })
  it('permits the next target after verified sync without deleting the retained maintenance branch', () => {
    const branch = 'maintenance/completed'
    const pr = { number: 3, state: 'MERGED', body: prMarker(target), headRefName: branch, mergeCommit: { oid: sha } }
    expect(recover({ repository: target.repository, prs: [pr], branches: [branch], state: { status: 'synced', key: key(), target, branch }, syncedKeys: [key()] }).status).toBe('idle')
  })
  it('keeps an active older target fixed and does not trust local merged claims', () => {
    const pr = { number: 3, state: 'OPEN', body: prMarker(target), headRefName: 'maintenance/one' }
    expect(recover({ repository: target.repository, prs: [pr], branches: [], state: { status: 'merged', key: key(), target, repairAttempts: 0 } })).toMatchObject({ status: 'pr-open', target })
    expect(recover({ repository: target.repository, prs: [], branches: [], state: { status: 'merged', key: key(), target } }).status).toBe('blocked')
  })
  it('preserves corrupt state for diagnosis and can recover solely from a PR marker', async () => {
    const directory = await temp()
    const path = join(directory, 'state.json')
    await writeFile(path, '{broken')
    expect((await readState(path)).status).toBe('corrupt')
    expect(await readFile(path, 'utf8')).toBe('{broken')
    const restored = recover({ repository: target.repository, prs: [{ number: 3, state: 'OPEN', body: prMarker(target), headRefName: 'maintenance/one' }], branches: [] })
    await writeState(path, restored)
    expect((await readState(path)).state).toMatchObject({ status: 'blocked', target, repairAttempts: null })
    await expect(writeState(path, { ...restored, token: 'secret' })).rejects.toThrow()
    const changed = { ...target, asc: { ...target.asc, sha256: 'c'.repeat(64) } }
    await expect(writeState(path, { ...restored, target: changed })).rejects.toThrow('provenance')
    expect((await readState(path)).state.target.asc.sha256).toBe(checksum)
  })
})

function gateInput() {
  return { target, head: sha, evidence: { head: sha, target, fullVerify: true, baselineVerify: true }, policy: { enforced: true, requiredChecks: [{ name: 'test (22)', appId: 15368 }, { name: 'test (24)', appId: 15368 }, { name: 'contract', appId: 15368 }], reviewsSatisfied: true, squashAllowed: true, mergeQueue: false }, checks: ['test (22)', 'test (24)', 'contract'].map(name => ({ name, appId: 15368, head: sha, status: 'COMPLETED', conclusion: 'SUCCESS' })), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', unresolvedReviews: 0, withinScope: true, repairAttempts: 0 }
}
describe('final head merge gate', () => {
  it('accepts a successful third repair but rejects exhausted or unknown budgets', () => {
    expect(mergeGate({ ...gateInput(), repairAttempts: 3 }).allowed).toBe(true)
    expect(mergeGate({ ...gateInput(), repairAttempts: 3, evidence: { ...gateInput().evidence, fullVerify: false } }).allowed).toBe(false)
    for (const repairAttempts of [undefined, null, -1, 1.5, '2', 4]) {
      expect(mergeGate({ ...gateInput(), repairAttempts }).allowed).toBe(false)
    }
  })
  it('accepts complete evidence but rejects stale, skipped, missing, unknown and unresolved evidence', () => {
    expect(mergeGate(gateInput()).allowed).toBe(true)
    for (const patch of [
      { head: 'c'.repeat(40) }, { checks: gateInput().checks.slice(1) },
      { checks: gateInput().checks.map(check => ({ ...check, conclusion: 'SKIPPED' })) },
      { mergeable: 'UNKNOWN' }, { unresolvedReviews: 1 }, { withinScope: false },
      { policy: { ...gateInput().policy, enforced: false } },
      { evidence: { ...gateInput().evidence, fullVerify: false } },
      { policy: { ...gateInput().policy, mergeQueue: true } },
      { checks: gateInput().checks.map(check => ({ ...check, appId: 123 })) },
    ]) expect(mergeGate({ ...gateInput(), ...patch }).allowed).toBe(false)
  })
  it('rejects immutable source drift even when version numbers match', () => {
    expect(mergeGate({ ...gateInput(), evidence: { ...gateInput().evidence, target: { ...target, asc: { ...target.asc, sha256: 'c'.repeat(64) } } } }).allowed).toBe(false)
  })
})

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
async function repository() {
  const root = await temp()
  const remote = join(root, 'remote.git')
  const main = join(root, 'main')
  const writer = join(root, 'writer')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, main)
  git(main, 'config', 'user.name', 'Test')
  git(main, 'config', 'user.email', 'test@example.invalid')
  await writeFile(join(main, 'tracked'), 'base\n')
  git(main, 'add', '.')
  git(main, 'commit', '-m', 'base')
  git(main, 'push', 'origin', 'main')
  git(root, 'clone', remote, writer)
  git(writer, 'config', 'user.name', 'Test')
  git(writer, 'config', 'user.email', 'test@example.invalid')
  await writeFile(join(writer, 'tracked'), 'merged\n')
  git(writer, 'commit', '-am', 'merged')
  git(writer, 'push', 'origin', 'main')
  const mergeCommit = git(writer, 'rev-parse', 'HEAD')
  const options = { checkout: main, authorizedCheckout: main, expectedOrigin: remote, featureCheckout: writer, mergeCommit, exclusiveAccess: true }
  return { root, remote, main, writer, options }
}
describe('authorized main fast-forward', () => {
  it.each([false, 'false', 'true', 1, [], {}])('requires boolean true for exclusive access (%j)', async exclusiveAccess => {
    const { main, options } = await repository()
    const before = git(main, 'rev-parse', 'HEAD')
    expect(await syncCheckout({ ...options, exclusiveAccess })).toMatchObject({ status: 'sync-pending', reason: 'concurrent-use-not-excluded' })
    expect(git(main, 'rev-parse', 'HEAD')).toBe(before)
  })
  it('refuses an external token replaced while fetch was in progress', async () => {
    const { main, options } = await repository()
    const commonDir = await commonDirectory(main)
    const owner = await acquireLock({ commonDir, runId: 'old' })
    const replacement: { lock?: { status: string; release(): Promise<unknown> } } = {}
    const before = git(main, 'rev-parse', 'HEAD')
    try {
      const result = await syncCheckout({ ...options, lockToken: owner.owner.token, beforeUpdate: async () => {
        await owner.release()
        replacement.lock = await acquireLock({ commonDir, runId: 'new' })
      } })
      expect(result.status).toBe('sync-pending')
      expect(git(main, 'rev-parse', 'HEAD')).toBe(before)
    } finally { if (replacement.lock?.status === 'acquired') await replacement.lock.release() }
  })
  it('prevents lock release and takeover throughout the final Git update', async () => {
    const { main, options } = await repository()
    const commonDir = await commonDirectory(main)
    const owner = await acquireLock({ commonDir, runId: 'owner' })
    let releaseStatus: string | undefined
    const contender: { lock?: { status: string; release(): Promise<unknown> } } = {}
    try {
      const result = await syncCheckout({ ...options, lockToken: owner.owner.token, run: async (cwd: string, args: string[]) => {
        if (args[0] === 'merge') {
          releaseStatus = (await owner.release()).status
          contender.lock = await acquireLock({ commonDir, runId: 'contender', reclaimDead: true, ownerAlive: () => false })
        }
        return runGit(cwd, args)
      } })
      expect(result.status).toBe('synced')
      expect(releaseStatus).toBe('blocked')
      expect(contender.lock?.status).toBe('blocked')
    } finally {
      if (contender.lock?.status === 'acquired') await contender.lock.release()
      if (releaseStatus !== 'released') await owner.release()
    }
  })
  it('CLI lock excludes a second process and permits a new owner after release', async () => {
    const { main } = await repository()
    const cli = fileURLToPath(new URL('../scripts/maintenance/cli.mjs', import.meta.url))
    const child = spawn(process.execPath, [cli, 'hold-lock', '--checkout', main], { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = new Promise(resolveClose => child.once('close', resolveClose))
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        let text = ''
        child.once('error', rejectReady)
        child.once('exit', code => rejectReady(new Error(`Lock holder exited before ready: ${code}`)))
        child.stdout.on('data', chunk => {
          text += chunk.toString()
          try { if (JSON.parse(text).status === 'acquired') resolveReady() } catch { /* wait for complete JSON */ }
        })
      })
      let refused: { status?: number; stdout?: string | Buffer } = {}
      try { execFileSync(process.execPath, [cli, 'hold-lock', '--checkout', main], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (error) { refused = error as typeof refused }
      expect(refused.status).toBe(2)
      expect(JSON.parse(String(refused.stdout)).status).toBe('blocked')
    } finally { child.kill('SIGTERM'); await closed }
    const next = await acquireLock({ commonDir: await commonDirectory(main), runId: 'after-process' })
    expect(next.status).toBe('acquired')
    await next.release()
  })
  it('fast-forwards and resumes idempotently after sync-before-save', async () => {
    const { main, writer, options } = await repository()
    const worktree = join(await temp(), 'worktree')
    git(main, 'worktree', 'add', '-b', 'feature', worktree)
    expect(await commonDirectory(main)).toBe(await commonDirectory(worktree))
    expect(await syncCheckout(options)).toMatchObject({ status: 'synced', head: options.mergeCommit, published: false })
    expect(await readFile(join(main, 'tracked'), 'utf8')).toBe('merged\n')
    expect((await syncCheckout(options)).status).toBe('synced')
    expect(git(writer, 'rev-parse', 'HEAD')).toBe(git(main, 'rev-parse', 'HEAD'))
  })
  it.each(['dirty', 'untracked', 'diverged', 'branch', 'origin', 'operation', 'concurrency', 'unauthorized', 'feature'])('preserves checkout on %s refusal', async reason => {
    const { main, options } = await repository()
    if (reason === 'dirty') await writeFile(join(main, 'tracked'), 'user edit\n')
    if (reason === 'untracked') await writeFile(join(main, 'untracked'), 'user file')
    if (reason === 'diverged') { await writeFile(join(main, 'local'), 'local'); git(main, 'add', '.'); git(main, 'commit', '-m', 'local') }
    if (reason === 'branch') git(main, 'switch', '-c', 'user-branch')
    if (reason === 'origin') options.expectedOrigin = 'https://github.com/other/repo.git'
    if (reason === 'operation') await writeFile(join(main, '.git', 'MERGE_HEAD'), options.mergeCommit)
    if (reason === 'concurrency') options.exclusiveAccess = false
    if (reason === 'unauthorized') options.authorizedCheckout = options.featureCheckout
    if (reason === 'feature') options.featureCheckout = main
    const before = git(main, 'rev-parse', 'HEAD')
    const content = await readFile(join(main, 'tracked'), 'utf8')
    expect((await syncCheckout(options)).status).toBe('sync-pending')
    expect(git(main, 'rev-parse', 'HEAD')).toBe(before)
    expect(await readFile(join(main, 'tracked'), 'utf8')).toBe(content)
  })
  it('does not overwrite an ignored user file introduced by the remote update', async () => {
    const { main, writer, options } = await repository()
    await writeFile(join(main, '.git', 'info', 'exclude'), 'ignored-local\n')
    await writeFile(join(main, 'ignored-local'), 'user-owned ignored file')
    await writeFile(join(writer, 'ignored-local'), 'upstream tracked file')
    git(writer, 'add', 'ignored-local')
    git(writer, 'commit', '-m', 'track formerly ignored path')
    git(writer, 'push', 'origin', 'main')
    options.mergeCommit = git(writer, 'rev-parse', 'HEAD')
    const before = git(main, 'rev-parse', 'HEAD')
    expect((await syncCheckout(options)).status).toBe('sync-pending')
    expect(git(main, 'rev-parse', 'HEAD')).toBe(before)
    expect(await readFile(join(main, 'ignored-local'), 'utf8')).toBe('user-owned ignored file')
  })
  it('detects edits arriving after fetch before updating the ref', async () => {
    const { main, options } = await repository()
    const before = git(main, 'rev-parse', 'HEAD')
    const result = await syncCheckout({ ...options, beforeUpdate: async () => writeFile(join(main, 'tracked'), 'concurrent edit') })
    expect(result.status).toBe('sync-pending')
    expect(git(main, 'rev-parse', 'HEAD')).toBe(before)
    expect(await readFile(join(main, 'tracked'), 'utf8')).toBe('concurrent edit')
  })
})
