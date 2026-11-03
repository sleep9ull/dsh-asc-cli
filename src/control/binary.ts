/** Shared, dynamic engine resolution for probes, tools and jobs. */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { PINNED_ASC_VERSION } from '../compat.js'
import type { Config } from '../config.js'

export type AscSource = 'configured' | 'env' | 'cache' | 'path'
export interface AscResolution {
  readonly path: string
  readonly source: AscSource
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
