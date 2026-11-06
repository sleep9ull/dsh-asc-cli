import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const temporary: string[] = []
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'asc-matrix-test-'))
  temporary.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('rebuilds changed source before packaging the artifact certified by the host matrix', () => {
  const directory = fixture()
  for (const name of ['scripts', 'src', 'test/fixtures', 'package.json', 'package-lock.json']) cpSync(new URL(name, root), join(directory, name), { recursive: true })
  // Consumer roots describe the verification harness; use the installed plugin's
  // public declaration when this suite itself runs inside a packed consumer.
  if (process.env.ASC_HARNESS_BUILT === '1') cpSync(new URL('node_modules/@sleep9ull/dsh-asc-cli/package.json', root), join(directory, 'package.json'))
  mkdirSync(join(directory, 'lib'))
  writeFileSync(join(directory, 'lib/index.js'), 'stale build')
  const preload = join(directory, 'preload.mjs')
  writeFileSync(preload, `
import childProcess from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {syncBuiltinESMExports} from 'node:module'
childProcess.execFileSync = (file, argv, options) => {
  if (argv.includes('build')) { writeFileSync(join(options.cwd, 'lib/index.js'), 'fresh build'); return '' }
  if (argv.includes('pack')) throw new Error([readFileSync(join(options.cwd, 'lib/index.js'), 'utf8') === 'fresh build' ? 'FRESH' : 'STALE', 'PACKAGE', 'STOP'].join('_'))
  throw new Error('Unexpected external process')
}
syncBuiltinESMExports()
globalThis.fetch = () => { throw new Error('Unexpected network') }
`)
  let stderr = ''
  try {
    execFileSync(process.execPath, ['--import', preload, join(directory, 'scripts/harness-matrix.mjs')], { encoding: 'utf8', stdio: 'pipe' })
  } catch (error) { stderr = String((error as { stderr: unknown }).stderr) }
  expect(stderr).toContain('FRESH_PACKAGE_STOP')
  expect(readFileSync(join(directory, 'lib/index.js'), 'utf8')).toBe('fresh build')
})

it('executes the Windows npm CLI through Node while preserving paths and literal arguments', async () => {
  const modulePath = new URL('../scripts/npm-command.mjs', import.meta.url).href
  const { npmCommand } = await import(modulePath)
  const directory = fixture()
  const cli = join(directory, 'npm CLI with spaces.cjs')
  writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)))')
  const args = ['install', '--cache=space dir', 'literal&echo', '$(not-a-command)']
  const command = npmCommand(args, { platform: 'win32', npmExecPath: cli })
  const result = execFileSync(command.file, command.args, { encoding: 'utf8', shell: false })
  expect(JSON.parse(result)).toEqual(args)
  expect(command.file).toBe(process.execPath)
})
