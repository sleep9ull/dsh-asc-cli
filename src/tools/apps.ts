/**
 * `asc_apps` — app inventory and App ID resolution.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `List or inspect App Store Connect apps (read-only). Use action "list" to find an app id (the numeric App Store Connect id used by every other tool), with optional name/bundle-id filters; use action "view" for one app's details. Defaults to 20 rows; set paginate for larger inventories.`

export function registerAppsTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_apps', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['list', 'view'],
      required: true,
      description: 'list apps or view one app.',
    },
    app: {
      type: 'string',
      description: 'App Store Connect app id (required for view; falls back to defaultAppId).',
    },
    name: { type: 'string', description: 'For list: filter by app name(s), comma-separated.' },
    bundleId: { type: 'string', description: 'For list: filter by bundle id(s), comma-separated.' },
    sort: { type: 'string', description: 'For list: name, -name, bundleId, -bundleId, sku or -sku.' },
    limit: { type: 'integer', description: 'Page size (1-200, default 20).' },
    paginate: { type: 'boolean', description: 'Fetch every page (can be large; prefer filters).' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
