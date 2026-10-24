/**
 * `asc_plan` — read-only plans: is this release ready, where is it, and what
 * would a metadata change do.
 *
 * `metadata-plan` is the one local-write action here: it computes a plan and
 * writes a review artifact, so it needs confirmation and approval.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Inspect readiness and compute plans without mutating App Store Connect.

Actions:
- validate: canonical submission-readiness report for an app/version, with an ordered remediation plan. Start here before any release step. Pass strict to treat warnings as blockers or deep for deeper checks.
- status: one-screen release dashboard; optionally wait for a condition (until: review-done, ready-for-sale, processed, testflight-ready, change) with a timeout. Long-running.
- metadata-plan: compute the metadata change plan and write a review artifact (local write; needs confirm and approval). Show the diff before metadata-apply.

Nothing here mutates App Store Connect. For a loop of steps use asc_job release-check / stage-release.`

export function registerPlanTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_plan', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['validate', 'status', 'metadata-plan'],
      required: true,
      description: 'Which plan to compute.',
    },
    app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
    version: { type: 'string', description: 'Marketing version, e.g. 1.2.3.' },
    platform: {
      type: 'string',
      enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
      description: 'Platform filter.',
    },
    include: {
      type: 'array',
      items: { type: 'string' },
      description: 'For status: sections to include (app, builds, testflight, appstore, submission, review, phased-release, links).',
    },
    until: {
      type: 'string',
      enum: ['review-done', 'ready-for-sale', 'processed', 'testflight-ready', 'change'],
      description: 'For status: wait until this condition is reached.',
    },
    timeout: { type: 'string', description: 'For status: max wait, e.g. 2h or 30m.' },
    strict: { type: 'boolean', description: 'For validate: treat warnings as blocking.' },
    deep: { type: 'boolean', description: 'For validate: run deeper checks.' },
    dir: { type: 'string', description: 'For metadata-plan: metadata root directory.' },
    reviewDir: { type: 'string', description: 'For metadata-plan: directory for the review artifact.' },
    confirm: { type: 'boolean', description: 'For metadata-plan: confirm writing the review artifact.' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
