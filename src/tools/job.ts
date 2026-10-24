/**
 * `asc_job` — product-level workflows composed from `asc` commands.
 *
 * One call returns a plan-shaped result with per-step summaries, so the model
 * does not have to invent an orchestration (and cannot silently reorder one).
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { AscEngine } from '../control/engine.js'
import { renderResult, type AscToolResult } from '../format.js'
import { jobIds, runJob, type JobArgs, type JobResult } from '../jobs.js'
import type { AscRuntime } from '../runtime.js'
import { RESULT_SCHEMA } from './common.js'

const DESCRIPTION = `Run one delivery job end to end. Prefer a job over assembling asc commands yourself.

Jobs:
- release-check (read-only): run validate for an app/version and return blockers with ordered fixes.
- ship-testflight (write): upload an .ipa/.pkg (waits for processing) and add the build to a TestFlight group; pass dryRun first.
- stage-release (write): validate, then prepare the version (metadata + build) without submitting; pass dryRun first.
- triage-feedback (read-only): aggregate TestFlight feedback, crashes and optional reviews.
- compliance-sweep (read-only): probe age rating, encryption declarations, accessibility and current pricing; a failed probe is reported, not fatal.

Write jobs need mode "write", an explicit confirm: true and host approval. Always show the user the dry-run result before a real run.`

function renderJob(value: JobResult): string {
  const header = `## ${value.title} (${value.job}) · ${value.ok ? 'ok' : 'failed'}${value.dryRun ? ' · dry run' : ''}`
  const steps = value.steps.map((step) => `- ${step.ok ? '✓' : '✗'} ${step.name}: ${step.summary}`)
  const lines = [header, ...steps, value.summary]
  if (value.errorClass !== undefined) lines.push(`error class: ${value.errorClass}`)
  if (value.hint !== undefined) lines.push(`next: ${value.hint}`)
  if (value.ascVersion !== undefined) lines.push(`asc: ${value.ascVersion}`)
  return lines.join('\n')
}

export function registerJobTool(ctx: Context, runtime: AscRuntime, engine: AscEngine): void {
  const tool = defineTool({
    name: 'asc_job',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        enum: jobIds(),
        required: true,
        description: 'Which job to run.',
      },
      app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
      version: { type: 'string', description: 'Marketing version, e.g. 1.2.3.' },
      platform: {
        type: 'string',
        enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
        description: 'Platform filter.',
      },
      buildId: { type: 'string', description: 'For stage-release: the build id to attach.' },
      file: { type: 'string', description: 'For ship-testflight: path to the .ipa or .pkg file.' },
      buildNumber: { type: 'string', description: 'For ship-testflight: build number (CFBundleVersion).' },
      group: { type: 'string', description: 'For ship-testflight: TestFlight beta group id(s) or name(s).' },
      metadataDir: { type: 'string', description: 'For stage-release: metadata directory to apply.' },
      limit: { type: 'integer', description: 'For triage-feedback: page size (default 20).' },
      dryRun: { type: 'boolean', description: 'Preview the job without mutating App Store Connect.' },
      submit: { type: 'boolean', description: 'For ship-testflight: submit for beta review after adding external groups.' },
      confirm: { type: 'boolean', description: 'Explicit confirmation for write jobs. Only after the user agrees.' },
    },
    timeoutMs: runtime.config.longTimeoutMs + 30_000,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderJob(value as unknown as JobResult) }],
      presentationMeta: (_args, value) => {
        const result = value as unknown as JobResult
        return { ok: result.ok, dryRun: result.dryRun }
      },
    },
    presentCall: (args) => {
      const action = (args as { action?: unknown }).action
      return {
        card: 'terminal',
        title: `asc_job ${typeof action === 'string' ? action : ''}`.trim(),
        description: 'App Store Connect workflow',
      }
    },
    presentResult: (_args, result) => {
      const meta = (result.meta ?? {}) as { ok?: unknown }
      const ok = typeof meta.ok === 'boolean' ? meta.ok : !result.isError
      const output = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
      return { card: 'terminal', title: 'asc_job', output, exitCode: ok ? 0 : 1 }
    },
    async execute(args, exec: ToolRunContext) {
      const action = typeof args.action === 'string' ? args.action : ''
      const jobArgs: JobArgs = {
        ...(args.app === undefined ? {} : { app: args.app }),
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.platform === undefined ? {} : { platform: args.platform }),
        ...(args.buildId === undefined ? {} : { buildId: args.buildId }),
        ...(args.file === undefined ? {} : { file: args.file }),
        ...(args.buildNumber === undefined ? {} : { buildNumber: args.buildNumber }),
        ...(args.group === undefined ? {} : { group: args.group }),
        ...(args.metadataDir === undefined ? {} : { metadataDir: args.metadataDir }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
        ...(args.submit === undefined ? {} : { submit: args.submit }),
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
      }
      const result = await runJob(action, jobArgs, {
        config: runtime.config,
        exec,
        runtime,
        engine,
      })
      return result as unknown as JsonValue
    },
  })
  ctx.effect(() => ctx.tools.register(tool))
}

/** Re-exported for the setup tool's diagnose renderer. */
export function renderAscResult(value: AscToolResult): string {
  return renderResult(value)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}
