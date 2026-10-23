/**
 * `asc_builds` — build inventory, uploads and TestFlight distribution.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Manage builds in App Store Connect. Actions:
- list: recent builds with processing state (read-only).
- next-number: compute the next safe build number for a version/platform (read-only).
- upload: upload a prebuilt .ipa (iOS/tvOS/visionOS) or .pkg (macOS) and optionally wait for processing. Long-running; requires confirm and approval.
- add-groups: add a build to TestFlight beta groups, optionally submitting for beta review (--submit). Requires confirm and approval.
Uploads and group changes mutate App Store Connect, so they are refused in read-only mode.`

export function registerBuildsTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_builds', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['list', 'next-number', 'upload', 'add-groups'],
      required: true,
      description: 'Which build operation to run.',
    },
    app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
    limit: { type: 'integer', description: 'For list: page size (1-200, default 20).' },
    version: { type: 'string', description: 'Marketing version filter (CFBundleShortVersionString).' },
    buildNumber: { type: 'string', description: 'Build number filter (CFBundleVersion).' },
    platform: {
      type: 'string',
      enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
      description: 'Platform filter.',
    },
    excludeExpired: { type: 'boolean', description: 'For list/next-number: exclude expired builds.' },
    paginate: { type: 'boolean', description: 'For list: fetch every page.' },
    file: {
      type: 'string',
      description: 'For upload: absolute or working-directory-relative path to the .ipa or .pkg file.',
    },
    wait: { type: 'boolean', description: 'For upload: wait for processing to finish.' },
    dryRun: { type: 'boolean', description: 'For upload/add-groups: preview without mutating.' },
    group: { type: 'string', description: 'For add-groups: beta group id(s) or exact name(s), comma-separated.' },
    buildId: { type: 'string', description: 'For add-groups: target build id instead of the latest build.' },
    submit: { type: 'boolean', description: 'For add-groups: submit for beta app review after adding external groups.' },
    confirm: { type: 'boolean', description: 'Explicit confirmation for upload/add-groups. Only after the user agrees.' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
