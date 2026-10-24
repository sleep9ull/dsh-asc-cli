/**
 * @sleep9ull/dsh-asc-cli — App Store Connect operations for DeepSeek Harness.
 *
 * The plugin is a product layer over the `asc` CLI:
 *  - five delivery jobs (`asc_job`) for the workflows that matter,
 *  - an intent-shaped tool surface: `asc` (read), `asc_plan` (plans),
 *    `asc_apply` (mutations), `asc_setup` (engine), with `asc.run` as the
 *    escape hatch,
 *  - a bundled skill pack (quickstart + workflow guidance) shipped in the
 *    package, so installing the plugin is enough for the agent to know how to
 *    use it,
 *  - an engine manager (`asc_setup diagnose` / `provision`, `/asc-doctor`)
 *    that locates, checks and optionally installs `asc`,
 *  - `/asc` and `/asc-doctor` commands for humans,
 *  - read-only by default, confirmation and host approval for writes, an
 *    optional JSONL audit trail, and compact structured results.
 *
 * @module @sleep9ull/dsh-asc-cli
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerApproval } from './approval.js'
import { createAudit } from './audit.js'
import { registerCommands } from './commands.js'
import { Config, type Config as AscConfig } from './config.js'
import { createEngine } from './control/engine.js'
import { createRuntime } from './runtime.js'
import { registerSkills } from './skills.js'
import { registerApplyTool } from './tools/apply.js'
import { registerAscTool } from './tools/asc.js'
import { registerJobTool } from './tools/job.js'
import { registerPlanTool } from './tools/plan.js'
import { registerSetupTool } from './tools/setup.js'

/** Cordis plugin name. */
export const name = 'asc-tools'

/** Services that must exist before {@link apply} runs. */
export const inject = ['tools', 'subprocess']

/**
 * Register every tool, command, bundled skill and the pre-execution policy.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: AscConfig): void {
  const audit = createAudit(config)
  const runtime = createRuntime(ctx, config, undefined, audit)
  const engine = createEngine(config, runtime.spawn)

  registerApproval(ctx, config)
  registerSetupTool(ctx, runtime, engine)
  registerJobTool(ctx, runtime, engine)
  registerAscTool(ctx, runtime)
  registerPlanTool(ctx, runtime)
  registerApplyTool(ctx, runtime)

  // Optional surfaces: no-ops when the composition lacks the service.
  registerSkills(ctx)
  registerCommands(ctx, engine)
}

export { Config }
