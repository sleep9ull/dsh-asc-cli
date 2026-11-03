#!/usr/bin/env node
/** Render a development overlay pointing at this checkout, including worktrees. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vendorAscPath } from './vendor-path.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.slice(2).some((arg) => arg !== '--write')) throw new Error('Usage: node scripts/dev-patch.mjs [--write]')
const write = process.argv.includes('--write')
const plugin = resolve(root, 'lib/index.js')
const asc = vendorAscPath()
if (!existsSync(plugin) || !existsSync(asc)) throw new Error('Build and download the engine before generating an overlay')
const template = resolve(root, write ? 'dev/cordis.write.patch.yml' : 'dev/cordis.patch.yml')
const rendered = readFileSync(template, 'utf8')
  .replace('__ASC_PLUGIN_ENTRY__', JSON.stringify(plugin))
  .replace('__ASC_ENGINE_PATH__', JSON.stringify(asc))
const target = resolve(root, write ? 'vendor/cordis.write.patch.yml' : 'vendor/cordis.dev.patch.yml')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, rendered, { mode: 0o600 })
console.log(target)
