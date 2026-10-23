/**
 * `asc_metadata` — deterministic metadata workflows with dry-run first.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Manage App Store metadata from canonical JSON files. Actions:
- init: scaffold metadata template files in a directory (writes local files only).
- validate: validate canonical files offline (read-only).
- plan: compute a deterministic change plan and write a review artifact (read-only; this is the default before any apply).
- apply: apply canonical files to App Store Connect. Pass dryRun for a preview; a real apply requires confirm and approval.
Always plan or dry-run first, show the user the diff, then apply with confirm.`

export function registerMetadataTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_metadata', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['init', 'validate', 'plan', 'apply'],
      required: true,
      description: 'Which metadata operation to run.',
    },
    app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
    version: { type: 'string', description: 'Marketing version, e.g. 1.2.3.' },
    dir: {
      type: 'string',
      description: 'Metadata root directory (required for init/validate/plan/apply).',
    },
    locale: { type: 'string', description: 'For init: locale to scaffold (default en-US).' },
    platform: {
      type: 'string',
      enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
      description: 'Platform for plan/apply.',
    },
    reviewDir: { type: 'string', description: 'Directory for the metadata review artifact.' },
    force: { type: 'boolean', description: 'For init: overwrite existing template files.' },
    dryRun: { type: 'boolean', description: 'For apply: preview without mutating App Store Connect.' },
    confirm: { type: 'boolean', description: 'Explicit confirmation for a real apply. Only after the user agrees.' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
