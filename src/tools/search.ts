/**
 * `asc_search` — upstream command discovery for the long tail.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Search the asc CLI's own command tree for a command, flag or example (local and deterministic, no App Store Connect request). Use this before asc_run when you are unsure which asc command or flag to use. Returns ranked matches with command paths and examples.`

export function registerSearchTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_search', DESCRIPTION, {
    query: {
      type: 'string',
      required: true,
      description: 'Natural-language or keyword query, e.g. "upload a build" or "external testers".',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of matches (default 10).',
    },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
