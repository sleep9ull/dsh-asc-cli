/**
 * dsh-asc-cli — App Store Connect operations for DeepSeek Harness.
 *
 * The plugin is a thin, opinionated layer over the `asc` CLI:
 *  - typed tools for the high-frequency release workflows,
 *  - `asc_run` / `asc_search` for the long tail,
 *  - read-only by default, with per-call confirmation and host approvals for
 *    every mutation,
 *  - compact, structured results instead of raw JSON.
 *
 * @module dsh-asc-cli
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerApproval } from './approval.js'
import { Config, type Config as AscConfig } from './config.js'
import { createRuntime } from './runtime.js'
import { registerAppsTool } from './tools/apps.js'
import { registerBuildsTool } from './tools/builds.js'
import { registerMetadataTool } from './tools/metadata.js'
import { registerReleaseTool } from './tools/release.js'
import { registerRunTool } from './tools/run.js'
import { registerSearchTool } from './tools/search.js'
import { registerSetupTool } from './tools/setup.js'
import { registerTestflightTool } from './tools/testflight.js'

/** Cordis plugin name. */
export const name = 'asc-tools'

/** Services that must exist before {@link apply} runs. */
export const inject = ['tools', 'subprocess']

/**
 * Register every `asc_*` tool and the pre-execution policy.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: AscConfig): void {
  const runtime = createRuntime(ctx, config)
  registerApproval(ctx, config)
  registerSetupTool(ctx, runtime)
  registerSearchTool(ctx, runtime)
  registerRunTool(ctx, runtime)
  registerAppsTool(ctx, runtime)
  registerBuildsTool(ctx, runtime)
  registerTestflightTool(ctx, runtime)
  registerMetadataTool(ctx, runtime)
  registerReleaseTool(ctx, runtime)
}

export { Config }
