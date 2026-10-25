#!/usr/bin/env node
/**
 * Published-artifact manifest: the `lib/` directory must be exactly the set of
 * files derived from `src/`.
 *
 * `tsc` never deletes output, so a module removed from `src/` keeps its stale
 * `.js` / `.d.ts` / `.js.map` in `lib/` and silently ships in the tarball
 * (`package.json#files` only says `lib`). This check makes that impossible:
 * every expected artifact must exist and nothing else may.
 *
 * Usage: node scripts/pack-manifest.mjs   (after `npm run build`)
 */

import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Recursively list regular files under `dir` as root-relative POSIX paths. */
function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.isFile()) files.push(relative(root, full).split(sep).join('/'))
  }
  return files
}

const libDir = join(root, 'lib')
try {
  if (!statSync(libDir).isDirectory()) throw new Error('not a directory')
} catch {
  console.error('pack-manifest: lib/ is missing — run `npm run build` first')
  process.exit(1)
}

const sources = walk(join(root, 'src'))
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'))
  .sort()

// `tsconfig.build.json`: rootDir "src", outDir "lib", declaration true,
// declarationMap false, sourceMap true.
const expected = sources
  .flatMap((path) => {
    const stem = path.slice('src/'.length, -'.ts'.length)
    return [`lib/${stem}.js`, `lib/${stem}.d.ts`, `lib/${stem}.js.map`]
  })
  .sort()

const actual = walk(libDir).sort()

const expectedSet = new Set(expected)
const actualSet = new Set(actual)
const missing = expected.filter((path) => !actualSet.has(path))
const extra = actual.filter((path) => !expectedSet.has(path))

console.log(`pack-manifest: ${sources.length} source file(s) -> ${expected.length} expected artifact(s)`)
console.log(`pack-manifest: lib/ contains ${actual.length} file(s)`)

if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) {
    console.error(`\npack-manifest: ${missing.length} missing artifact(s) (build is stale or incomplete):`)
    for (const path of missing) console.error(`- ${path}`)
  }
  if (extra.length > 0) {
    console.error(`\npack-manifest: ${extra.length} unexpected file(s) in lib/ (stale output):`)
    for (const path of extra) console.error(`- ${path}`)
  }
  console.error('\npack-manifest: run `npm run build` (it cleans lib/) and retry')
  process.exit(1)
}

console.log('pack-manifest: lib/ matches src/ exactly')
