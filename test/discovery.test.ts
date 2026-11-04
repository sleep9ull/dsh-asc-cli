import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

it('collects this checkout’s tests without collecting nested worktrees', () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'asc-discovery-'))
  try {
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}')
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction')
    const config = join(root, 'vitest.config.ts')
    if (existsSync(config)) cpSync(config, join(directory, 'vitest.config.ts'))
    for (const file of ['test/root.test.ts', 'test/nested/child.test.ts', '.claude/worktrees/other/test/foreign.test.ts']) {
      const path = join(directory, file)
      mkdirSync(dirname(path), { recursive: true })
      // Collection alone must detect the foreign file, without executing it.
      writeFileSync(path, 'throw new Error("Collection must not execute fixtures")\n')
    }
    const output = execFileSync(process.execPath, [
      join(root, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', '--json',
    ], { cwd: directory, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] })
    const files = (JSON.parse(output) as { file: string }[])
      .map(({ file }) => relative(directory, resolve(directory, file)).split('\\').join('/')).sort()
    expect(files).toEqual(['test/nested/child.test.ts', 'test/root.test.ts'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
