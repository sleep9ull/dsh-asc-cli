/**
 * `asc_testflight` — TestFlight feedback, crashes and groups.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Read TestFlight signal for an app (read-only). Actions:
- feedback: tester feedback submissions (optionally newest first).
- crashes: crash submissions with build/device context.
- groups: internal and external beta groups.
Use this to triage a build or answer "what are testers reporting". For a single crash's log use asc_run with ["testflight","crashes","log","--submission-id","..."].`

export function registerTestflightTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_testflight', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['feedback', 'crashes', 'groups'],
      required: true,
      description: 'Which TestFlight data to read.',
    },
    app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
    limit: { type: 'integer', description: 'Page size (1-200, default 20).' },
    sort: { type: 'string', description: 'createdDate or -createdDate (newest first).' },
    paginate: { type: 'boolean', description: 'Fetch every page.' },
    internal: { type: 'boolean', description: 'For groups: internal groups only.' },
    external: { type: 'boolean', description: 'For groups: external groups only.' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
