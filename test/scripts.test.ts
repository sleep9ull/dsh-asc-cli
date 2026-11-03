import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = realpathSync(tmpdir())
const fixtures: string[] = []
const bytes = 'offline release fixture'

// Run the actual entrypoints, with isolated files and process-level seams. Native
// process execution is intercepted: a Windows executable cannot run on macOS/Linux.
function checkout(platform: string) {
  const directory = mkdtempSync(join(temporaryRoot, 'asc-scripts-'))
  fixtures.push(directory)
  cpSync(join(root, 'scripts'), join(directory, 'scripts'), { recursive: true })
  cpSync(join(root, 'dev'), join(directory, 'dev'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}')
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction')
  // Tests must work before a build and must not consume stale lib/ artifacts.
  for (const entry of readdirSync(join(root, 'src'), { recursive: true })) {
    const relative = String(entry)
    if (!relative.endsWith('.ts')) continue
    const target = join(directory, 'lib', relative.replace(/\.ts$/, '.js'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, transpileModule(readFileSync(join(root, 'src', relative), 'utf8'), {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ESNext },
    }).outputText)
  }
  mkdirSync(join(directory, 'vendor'))
  writeFileSync(join(directory, 'preload.mjs'), `
import fs from 'node:fs'
import childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { PINNED_ASC_VERSION, releaseAsset } from './lib/compat.js'
Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} })
Object.defineProperty(process, 'arch', { value: 'x64' })
const calls = []
const record = (file, argv) => calls.push({ file, argv })
process.on('exit', () => console.log('SCRIPT_CALLS=' + JSON.stringify(calls)))
const probe = process.env.ASC_SCRIPT_PROBE
if (probe === 'contract.mjs') childProcess.spawnSync = (file, argv) => {
  record(file, argv)
  process.exit(0)
}
if (probe === 'classify-audit.mjs') childProcess.execFileSync = (file, argv) => {
  record(file, argv)
  process.exit(0)
}
if (probe === 'verify.mjs') childProcess.execFileSync = (file, argv) => {
  record(file, argv)
  return ''
}
if (probe === 'smoke.mjs') {
  const exists = fs.existsSync
  fs.existsSync = (file) => {
    if (String(file).includes('vendor')) {
      record(file, [])
      process.exit(0)
    }
    return exists(file)
  }
}
syncBuiltinESMExports()
globalThis.fetch = async (url) => {
  const asset = releaseAsset(PINNED_ASC_VERSION)
  const digest = createHash('sha256').update(${JSON.stringify(bytes)}).digest('hex')
  if (String(url).endsWith('_checksums.txt')) return new Response(digest + '  ' + asset + '\\n')
  if (String(url).endsWith('/' + asset)) return new Response(process.env.ASC_SCRIPT_CORRUPT ? 'tampered' : ${JSON.stringify(bytes)})
  throw new Error('Unexpected offline fetch: ' + url)
}
`)
  return {
    directory,
    engine: join(directory, 'vendor', platform === 'win32' ? 'asc.exe' : 'asc'),
    run(script: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
      return execFileSync(process.execPath, ['--import', join(directory, 'preload.mjs'), join(directory, 'scripts', script), ...args], {
        // Deliberately outside the checkout: default vendor paths belong to the script.
        cwd: temporaryRoot, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, ASC_SCRIPT_PROBE: script, ASC_SCRIPT_CORRUPT: '', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
      })
    },
  }
}

function calls(output: string): { file: string; argv: string[] }[] {
  return JSON.parse(output.split('\n').find((line) => line.startsWith('SCRIPT_CALLS='))!.slice('SCRIPT_CALLS='.length))
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('vendor executable script integration', () => {
  it.each(['win32', 'darwin', 'linux'])('installs verified bytes where every %s consumer looks', (platform) => {
    const fixture = checkout(platform)
    fixture.run('download-asc.mjs')
    expect(readFileSync(fixture.engine, 'utf8')).toBe(bytes)
    expect(readdirSync(join(fixture.directory, 'vendor'))).toEqual([platform === 'win32' ? 'asc.exe' : 'asc'])

    for (const script of ['contract.mjs', 'classify-audit.mjs', 'smoke.mjs']) {
      const invoked = calls(fixture.run(script))
      expect(invoked[0]?.file, script).toBe(fixture.engine)
    }
    const steps = calls(fixture.run('verify.mjs'))
    for (const script of ['contract.mjs', 'classify-audit.mjs', 'smoke.mjs']) {
      const step = steps.find((call) => call.argv[0] === `scripts/${script}`)
      expect(step?.argv[1], script).toBe(fixture.engine)
    }
    for (const flag of [[], ['--write']]) {
      fixture.run('dev-patch.mjs', flag)
      const overlay = join(fixture.directory, 'vendor', flag.length ? 'cordis.write.patch.yml' : 'cordis.dev.patch.yml')
      expect(readFileSync(overlay, 'utf8')).toContain(JSON.stringify(fixture.engine))
    }
  }, 30_000)

  it('rejects a corrupt Windows download without replacing the installed executable', () => {
    const fixture = checkout('win32')
    writeFileSync(fixture.engine, 'existing verified engine')
    expect(() => fixture.run('download-asc.mjs', [], { ASC_SCRIPT_CORRUPT: '1' })).toThrow(/SHA-256 mismatch/)
    expect(readFileSync(fixture.engine, 'utf8')).toBe('existing verified engine')
    expect(readdirSync(join(fixture.directory, 'vendor'))).toEqual(['asc.exe'])
  })

  it('preserves explicit engine paths for the three standalone checks on Windows', () => {
    const fixture = checkout('win32')
    const explicit = join(fixture.directory, 'custom-vendor', 'asc-custom.exe')
    // classify-audit checks existence before invoking the process seam.
    mkdirSync(dirname(explicit), { recursive: true })
    writeFileSync(explicit, bytes)
    for (const script of ['contract.mjs', 'classify-audit.mjs', 'smoke.mjs']) {
      const invoked = calls(fixture.run(script, [relative(temporaryRoot, explicit)]))
      expect(invoked[0]?.file, script).toBe(explicit)
    }
  })
})
