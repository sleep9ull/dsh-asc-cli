import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))

it('packs unbuilt source into a loadable plugin without consumer install scripts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'asc-packaging-'))
  try {
    const source = join(directory, 'source')
    const consumer = join(directory, 'consumer')
    mkdirSync(source)
    mkdirSync(join(consumer, 'node_modules', '@sleep9ull'), { recursive: true })
    for (const name of ['src', 'skills', 'scripts/pack-manifest.mjs', 'tsconfig.json', 'tsconfig.build.json', 'package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE']) {
      const target = join(source, name)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(root, name), target, { recursive: true })
    }
    // Matrix consumers have a harness manifest; certify the installed plugin's
    // actual package declaration instead of that synthetic harness manifest.
    if (process.env.ASC_HARNESS_BUILT === '1') {
      cpSync(join(root, 'node_modules/@sleep9ull/dsh-asc-cli/package.json'), join(source, 'package.json'))
    }
    symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'junction')
    writeFileSync(join(directory, 'empty.npmrc'), '')
    writeFileSync(join(directory, 'global.npmrc'), '')
    const { npmCommand } = await import(new URL('../scripts/npm-command.mjs', import.meta.url).href)
    const command = npmCommand([
      'pack', '--json', '--offline', '--ignore-scripts=false', '--pack-destination', directory,
      `--userconfig=${join(directory, 'empty.npmrc')}`,
      `--globalconfig=${join(directory, 'global.npmrc')}`, `--cache=${join(directory, 'cache')}`,
    ])
    const [packed] = JSON.parse(execFileSync(command.file, command.args, {
      cwd: source, encoding: 'utf8', timeout: 60_000, stdio: 'pipe',
    })) as { filename: string }[]
    expect(packed?.filename).toEqual(expect.stringMatching(/\.tgz$/))
    const installed = join(consumer, 'node_modules', '@sleep9ull', 'dsh-asc-cli')
    mkdirSync(installed)
    execFileSync('tar', ['-xzf', join(directory, packed!.filename), '-C', installed, '--strip-components=1'])
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
    const installHooks = ['preinstall', 'install', 'postinstall', 'prepare'].filter(hook => manifest.scripts?.[hook])
    expect(installHooks, 'the distributed plugin must not require consumer script approval').toEqual([])
    expect(readFileSync(join(installed, manifest.types), 'utf8')).toContain('export')
    expect(readFileSync(join(installed, 'cordis.patch.yml'), 'utf8')).toBe(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
    // Supply only the host peers. Neither TypeScript nor the source build tools
    // are available in the consumer, and no lifecycle script is executed here.
    symlinkSync(join(root, 'node_modules', '@deepseek-ai'), join(consumer, 'node_modules', '@deepseek-ai'), 'junction')
    writeFileSync(join(consumer, 'package.json'), '{"type":"module"}')
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import { name, apply, inject } from '@sleep9ull/dsh-asc-cli'
      import { createSkillProvider } from './node_modules/@sleep9ull/dsh-asc-cli/lib/skills.js'
      const provider = createSkillProvider(${JSON.stringify(join(installed, 'skills'))})
      const candidates = await provider.list({})
      const skills = await Promise.all(candidates.map(async candidate => {
        const definition = await provider.get(candidate, {})
        if (!definition) throw new Error('Packaged skill cannot be loaded: ' + candidate.name)
        return candidate.name
      }))
      console.log(JSON.stringify({ name, apply: typeof apply, inject, skills }))
    `], { cwd: consumer, encoding: 'utf8', timeout: 20_000 }))
    expect(result).toMatchObject({ name: 'asc-tools', apply: 'function', inject: ['tools', 'subprocess'] })
    const expectedSkills = readdirSync(join(root, 'skills')).sort()
    expect(result.skills.sort()).toEqual(expectedSkills)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 90_000)
