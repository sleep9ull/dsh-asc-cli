/** Shared, dynamic engine resolution for probes, tools and jobs. */
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { PINNED_ASC_VERSION } from '../compat.js'
import type { Config } from '../config.js'

export type AscSource = 'configured' | 'env' | 'cache' | 'path'
export interface AscResolution {
  readonly path: string
  readonly source: AscSource
}

export interface EngineSnapshot {
  readonly resolution: AscResolution
  readonly identity: string
  readonly cwd: string
  readonly resolved: boolean
  readonly missing: boolean
}

/** Freeze the executable used by both the business invocation and its version probe. */
export function snapshotAscBinary(config: Config, cwd = config.workdir ?? process.cwd()): EngineSnapshot {
  const resolution = resolveAscBinary(config)
  const effectiveCwd = resolve(cwd)
  const windows = process.platform === 'win32'
  const environmentValue = (name: string): string | undefined => {
    if (!windows) return Object.hasOwn(config.env, name) ? config.env[name] : process.env[name]
    // Windows environment names are case-insensitive, with configured values taking precedence.
    for (const env of [config.env, process.env]) {
      const key = Object.keys(env).find((key) => key.toUpperCase() === name)
      if (key !== undefined) return env[key]
    }
    return undefined
  }
  const path = environmentValue('PATH')
  const pathExt = environmentValue('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD'
  const explicitPath = isAbsolute(resolution.path) || resolution.path.includes('/') || (windows && resolution.path.includes('\\'))
  const directories = explicitPath ? [''] : [
    ...(windows ? [effectiveCwd] : []),
    ...(path ?? (windows ? '' : '/usr/bin:/bin')).split(windows ? ';' : ':'),
  ]
  const names = [resolution.path]
  if (windows && !/\.[^/\\.]+$/.test(resolution.path)) {
    // Extensions are case-insensitive on Windows; both variants also permit portable fixtures.
    for (const extension of pathExt.split(';').filter((part) => /^\.[a-z0-9]+$/i.test(part))) {
      names.push(`${resolution.path}${extension}`, `${resolution.path}${extension.toLowerCase()}`)
    }
  }
  const context = [resolution.source, resolution.path, effectiveCwd, path, pathExt]
  const identity = (fingerprint: unknown[]) => createHash('sha256').update(JSON.stringify([...context, ...fingerprint])).digest('hex')
  let uncertain = false
  for (const directory of directories) {
    for (const name of names) {
      const candidate = resolve(effectiveCwd, directory, name)
      try {
        const actual = realpathSync(candidate)
        const stat = statSync(actual, { bigint: true })
        if (!stat.isFile()) { uncertain = true; continue }
        accessSync(actual, windows ? constants.F_OK : constants.X_OK)
        return {
          resolution: { path: actual, source: resolution.source },
          identity: identity([actual, ...[stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String)]),
          cwd: effectiveCwd,
          resolved: true,
          missing: false,
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') uncertain = true
      }
    }
  }
  return { resolution, identity: identity(['unresolved', uncertain]), cwd: effectiveCwd, resolved: false, missing: !uncertain }
}

export function cacheRoot(config: Config): string {
  if (config.cacheDir !== undefined) return resolve(config.cacheDir)
  const home = process.env.DSH_HOME?.trim()
  return resolve(home === undefined || home.length === 0 ? join(homedir(), '.dsh') : home, 'cache', 'asc-cli')
}

export function cachedBinaryPath(config: Config, version: string = PINNED_ASC_VERSION): string {
  return join(cacheRoot(config), version, `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'asc.exe' : 'asc')
}

export function resolveAscBinary(config: Config): AscResolution {
  if (config.ascPath !== 'asc') return { path: config.ascPath, source: 'configured' }
  const fromEnv = process.env.ASC_CLI_PATH?.trim()
  if (fromEnv !== undefined && fromEnv.length > 0) return { path: fromEnv, source: 'env' }
  const cached = cachedBinaryPath(config)
  if (existsSync(cached)) return { path: cached, source: 'cache' }
  return { path: config.ascPath, source: 'path' }
}
