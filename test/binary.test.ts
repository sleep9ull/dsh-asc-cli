import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapshotAscBinary } from '../src/control/binary.js'
import { makeConfig } from './helpers.js'

const directories: string[] = []
function directory() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'asc-snapshot-')))
  directories.push(path)
  return path
}
function executable(path: string, contents = 'fixture') {
  writeFileSync(path, contents)
  chmodSync(path, 0o755)
  return path
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('binary snapshots', () => {
  it('resolves relative configured paths against the invocation cwd', () => {
    const first = directory(), second = directory()
    executable(join(first, 'asc'))
    executable(join(second, 'asc'))
    const config = makeConfig({ ascPath: './asc' })
    const a = snapshotAscBinary(config, first), b = snapshotAscBinary(config, second)
    expect(a.resolution.path).toBe(join(first, 'asc'))
    expect(b.resolution.path).toBe(join(second, 'asc'))
    expect(a.resolved).toBe(true)
    expect(b.identity).not.toBe(a.identity)
  })

  it('uses configured PATH over parent PATH and tracks in-place replacements', () => {
    const first = directory(), second = directory()
    executable(join(first, 'asc'))
    executable(join(second, 'asc'))
    vi.stubEnv('PATH', second)
    vi.stubEnv('ASC_CLI_PATH', '')
    const config = makeConfig({ cacheDir: join(first, 'unused'), env: { PATH: first } })
    const before = snapshotAscBinary(config)
    expect(before.resolution).toEqual({ path: join(first, 'asc'), source: 'path' })
    executable(join(first, 'asc'), 'replacement with changed size')
    expect(snapshotAscBinary(config).identity).not.toBe(before.identity)
    expect(snapshotAscBinary(makeConfig({ cacheDir: join(first, 'unused') })).resolution.path).toBe(join(second, 'asc'))
  })

  it('fingerprints symlink targets and distinguishes absence from unusable files', () => {
    const root = directory()
    const target = executable(join(root, 'engine'))
    const link = join(root, 'asc')
    symlinkSync(target, link)
    const config = makeConfig({ ascPath: link })
    expect(snapshotAscBinary(config).resolution.path).toBe(target)
    const initial = snapshotAscBinary(config).identity
    executable(target, 'new engine')
    expect(snapshotAscBinary(config).identity).not.toBe(initial)
    expect(snapshotAscBinary(makeConfig({ ascPath: join(root, 'absent') }))).toMatchObject({ resolved: false, missing: true })
    mkdirSync(join(root, 'folder'))
    expect(snapshotAscBinary(makeConfig({ ascPath: join(root, 'folder') }))).toMatchObject({ resolved: false, missing: false })
  })

  it('resolves relative PATH entries against cwd and honors Windows PATHEXT', () => {
    const root = directory()
    mkdirSync(join(root, 'bin'))
    executable(join(root, 'bin', 'asc.EXE'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.stubEnv('ASC_CLI_PATH', '')
    const config = makeConfig({ cacheDir: join(root, 'unused'), env: { PATH: 'bin', PATHEXT: '.EXE;.COM' } })
    expect(snapshotAscBinary(config, root).resolution.path).toBe(join(root, 'bin', 'asc.EXE'))
  })
})
