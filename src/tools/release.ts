/**
 * `asc_release` — readiness, staging and publishing.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Run the App Store release pipeline. Actions:
- status: one-screen release dashboard for an app; optionally wait for a condition (until: review-done, ready-for-sale, processed, testflight-ready, change) with a timeout. Long-running.
- validate: canonical submission-readiness report with an ordered remediation plan (read-only; start here).
- stage: prepare a version (metadata + attach build + readiness) without submitting. Pass dryRun to preview; a real stage requires confirm and approval.
- publish: upload + attach + optionally submit. Pass dryRun to preview; requires confirm (and submit: true to actually submit) plus approval.
Never call publish without first running validate and showing the user the blockers.`

export function registerReleaseTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_release', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['status', 'validate', 'stage', 'publish'],
      required: true,
      description: 'Which release step to run.',
    },
    app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
    version: { type: 'string', description: 'Marketing version, e.g. 1.2.3 (validate/stage/publish).' },
    buildId: { type: 'string', description: 'Build id to attach (stage).' },
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
    metadataDir: { type: 'string', description: 'For stage/publish: metadata directory to apply.' },
    copyMetadataFrom: { type: 'string', description: 'For stage: copy localization text from this version.' },
    ipa: { type: 'string', description: 'For publish: path to a prebuilt .ipa.' },
    pkg: { type: 'string', description: 'For publish: path to a prebuilt macOS .pkg.' },
    buildNumber: { type: 'string', description: 'For publish: build number (CFBundleVersion).' },
    submit: { type: 'boolean', description: 'For publish: submit for App Review after attaching the build.' },
    wait: { type: 'boolean', description: 'For publish: wait for build processing.' },
    dryRun: { type: 'boolean', description: 'For stage/publish: preview the plan without mutating.' },
    confirm: { type: 'boolean', description: 'Explicit confirmation for stage/publish. Only after the user agrees.' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
