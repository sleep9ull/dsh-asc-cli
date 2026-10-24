/**
 * `asc_setup` — environment, authentication and engine lifecycle.
 *
 * `diagnose` and `provision` are handled by the engine manager instead of a
 * raw `asc` command: they answer "what is missing and what do I run next"
 * rather than exposing the CLI's own diagnostics.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderDoctorCard } from '../commands.js'
import type { AscEngine, DiagnoseReport, ProvisionResult } from '../control/engine.js'
import { renderResult, type AscToolResult } from '../format.js'
import type { AscRuntime } from '../runtime.js'
import type { ToolArgs } from '../registry.js'
import { RESULT_SCHEMA } from './common.js'

const DESCRIPTION = `Inspect and prepare the local asc environment. Actions:
- version: print the installed asc version and commit (read-only).
- auth-status: validate stored credentials against Apple (read-only, network).
- doctor: run asc's own keychain/config diagnosis (read-only).
- system-status: check Apple Developer service health (read-only).
- diagnose: plugin-level report — binary, version compatibility, auth, default app, provisioning (read-only).
- provision: download the pinned asc build into the plugin cache, verified against released checksums (needs confirm and approval; requires allowProvision).
- install-skills: install the official ASC agent-skill pack into the global skills directory (needs confirm and approval; requires git).

Prefer diagnose when something is unclear: it returns one next step.`

function isReport(value: unknown): value is DiagnoseReport {
  return value !== null && typeof value === 'object' && 'resolution' in value && 'checks' in value
}

function isProvision(value: unknown): value is ProvisionResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'ok' in value &&
    !('job' in value) &&
    !('summary' in value) &&
    !('checks' in value)
  )
}

function renderSetup(value: unknown): string {
  if (isReport(value)) return renderDoctorCard(value)
  if (isProvision(value)) {
    return value.ok
      ? `provisioned asc ${value.version ?? ''} at ${value.path ?? '?'} (${value.bytes ?? 0} bytes, checksum verified)`
      : `provision failed: ${value.error ?? 'unknown error'}`
  }
  return renderResult(value as AscToolResult)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

export function registerSetupTool(ctx: Context, runtime: AscRuntime, engine: AscEngine): void {
  const tool = defineTool({
    name: 'asc_setup',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        enum: ['version', 'auth-status', 'doctor', 'system-status', 'diagnose', 'provision', 'install-skills'],
        required: true,
        description: 'Which environment check or setup step to run.',
      },
      issuesOnly: {
        type: 'boolean',
        description: 'For system-status: only report ongoing Apple service incidents.',
      },
      confirm: {
        type: 'boolean',
        description: 'Required for provision and install-skills.',
      },
    },
    timeoutMs: Math.max(runtime.config.longTimeoutMs, 240_000),
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderSetup(value) }],
      presentationMeta: (_args, value) => {
        if (isReport(value)) return { ok: true, kind: 'diagnose' }
        if (isProvision(value)) return { ok: value.ok, kind: 'provision' }
        const result = value as unknown as AscToolResult
        return { ok: result.ok, kind: 'command' }
      },
    },
    presentCall: (args) => {
      const action = (args as { action?: unknown }).action
      return {
        card: 'terminal',
        title: `asc_setup${typeof action === 'string' ? ` ${action}` : ''}`,
        description: 'asc environment',
      }
    },
    presentResult: (_args, result) => {
      const meta = (result.meta ?? {}) as { ok?: unknown }
      const ok = typeof meta.ok === 'boolean' ? meta.ok : !result.isError
      const output = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
      return { card: 'terminal', title: 'asc_setup', output, exitCode: ok ? 0 : 1 }
    },
    async execute(args, exec: ToolRunContext) {
      const action = typeof args.action === 'string' ? args.action : ''
      if (action === 'diagnose') {
        return (await engine.diagnose()) as unknown as JsonValue
      }
      if (action === 'provision') {
        return (await engine.provision()) as unknown as JsonValue
      }
      return (await runtime.runAction('asc_setup', action, args as ToolArgs, exec)) as unknown as JsonValue
    },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
