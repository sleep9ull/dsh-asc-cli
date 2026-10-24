/**
 * Local smoke test: drives the compiled plugin runtime against a real `asc`
 * binary through a minimal child_process adapter that mimics the subprocess
 * seam. Run with: node scripts/smoke.mjs [--write]
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { resolve } from 'node:path'
import { renderStartCard } from '../lib/commands.js'
import { createEngine } from '../lib/control/engine.js'
import { createRuntime } from '../lib/runtime.js'

const ASC = resolve('vendor/asc')

function collectStream(maxBytes) {
  const chunks = []
  let total = 0
  return {
    push(chunk) {
      const text = chunk.toString('utf8')
      chunks.push(text)
      total += Buffer.byteLength(text)
      while (total > maxBytes && chunks.length > 1) {
        const removed = chunks.shift()
        total -= Buffer.byteLength(removed)
      }
    },
    reader() {
      return {
        readFrom: () => {
          const text = chunks.join('')
          return { text, nextOffset: Buffer.byteLength(text), lossy: total > maxBytes }
        },
      }
    },
  }
}

/** Minimal SubprocessHandle-compatible adapter over child_process. */
function spawnAdapter(spec) {
  const out = collectStream(8 * 1024 * 1024)
  const err = collectStream(1024 * 1024)
  const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => out.push(chunk))
  child.stderr.on('data', (chunk) => err.push(chunk))
  const done = new Promise((resolveDone) => {
    child.on('close', (exitCode, signal) => resolveDone({ exitCode, signal }))
  })
  spec.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: { stdout: out.reader(), stderr: err.reader() },
    done,
    terminate: () => child.kill('SIGTERM'),
    waitForExit: async () => true,
  }
}

const config = {
  ascPath: ASC,
  mode: process.argv.includes('--write') ? 'write' : 'read-only',
  requireApproval: true,
  timeoutMs: 60_000,
  longTimeoutMs: 120_000,
  maxOutputBytes: 262_144,
  bypassKeychain: false,
  telemetryDisabled: true,
  allowValueExpansion: false,
  unknownCommands: 'ask',
  allowProvision: false,
  maxDataBytes: 8_000,
  env: {},
}

const ctx = { reflect: { get: () => undefined } }
const runtime = createRuntime(ctx, config, spawnAdapter)
const exec = { signal: new AbortController().signal }

const cases = [
  ['asc_setup', 'version', {}],
  ['asc_search', undefined, { query: 'upload a build', limit: 3 }],
  ['asc_setup', 'auth-status', {}],
  ['asc_apps', 'list', {}],
]

for (const [tool, action, args] of cases) {
  const label = action ? `${tool}.${action}` : tool
  try {
    const result = await runtime.runAction(tool, action, args, exec)
    console.log(`\n### ${label}`)
    console.log(`ok=${result.ok} exit=${result.exitCode} class=${result.errorClass ?? '-'}`)
    console.log(result.summary.slice(0, 600))
    if (result.hint) console.log(`hint: ${result.hint}`)
  } catch (error) {
    console.log(`\n### ${label} THREW: ${error.message}`)
  }
}

// Engine manager + capability card (the /asc front door), against the real binary.
const engine = createEngine(config, spawnAdapter)
const report = await engine.diagnose({ validateAuth: false })
console.log('\n### asc_setup.diagnose')
console.log(`binary=${report.checks.find((check) => check.name === 'binary')?.ok} version=${report.version ?? '-'} compat=${report.compat} auth=${report.authenticated}`)
console.log('\n### /asc (capability card)')
console.log(renderStartCard(report, { skills: 5 }))
