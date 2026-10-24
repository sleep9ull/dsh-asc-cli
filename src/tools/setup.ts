/**
 * `asc_setup` — local environment and onboarding checks.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Inspect and prepare the local asc CLI environment. Actions:
- version: print the installed asc version and commit.
- auth-status: validate stored credentials against Apple (network).
- doctor: diagnose keychain/config/private-key problems.
- system-status: check Apple Developer service health.
- install-skills: install the official ASC agent-skill pack into the global skills directory (requires confirm and approval; needs git).
Read-only except install-skills, which writes to the user's global skill directory.`

export function registerSetupTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_setup', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['version', 'auth-status', 'doctor', 'system-status', 'install-skills'],
      required: true,
      description: 'Which environment check or setup step to run.',
    },
    issuesOnly: {
      type: 'boolean',
      description: 'For system-status: only report ongoing Apple service incidents.',
    },
    confirm: {
      type: 'boolean',
      description: 'Required for install-skills (writes to the global skills directory).',
    },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
