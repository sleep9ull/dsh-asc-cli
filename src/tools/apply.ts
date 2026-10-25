/**
 * `asc_apply` — every mutation the plugin performs, behind one policy surface.
 *
 * Each action needs `confirm: true` and host approval (write mode only).
 * Prefer a dry run first: `upload --dry-run`, `stage --dry-run`,
 * `metadata-apply --dry-run`.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AscRuntime } from '../runtime.js'
import { defineActionTool } from './common.js'

const DESCRIPTION = `Mutate App Store Connect. Every action needs mode "write", confirm: true and host approval; pass dryRun first when the action supports it. Invalid parameter combinations are rejected before approval, so fix the arguments instead of retrying.

Actions:
- upload: upload a prebuilt .ipa or .pkg and optionally wait for processing (long-running). dryRun and wait are mutually exclusive; a .pkg requires version and buildNumber (an .ipa does not).
- groups: add a build to TestFlight beta groups, optionally submitting for beta review (submit). submit and dryRun are mutually exclusive. Pass buildId for a build-scoped assignment (then app/version/platform are not sent); otherwise pass app to target the latest build.
- metadata-init: scaffold canonical metadata template files (local write).
- metadata-apply: apply canonical metadata to App Store Connect (dryRun previews; a real apply needs confirm).
- stage: prepare a version without submitting. Requires version and buildId, plus exactly one metadata source: metadataDir or copyMetadataFrom.
- publish: upload/attach (optionally submit) a version through asc publish appstore. Pass exactly one of ipa / pkg; a .pkg requires version and buildNumber, an .ipa may omit version (asc extracts it).

Never call stage/publish/metadata-apply without first showing the user the validate report or dry-run plan. For whole workflows prefer asc_job ship-testflight / stage-release.`

export function registerApplyTool(ctx: Context, runtime: AscRuntime): void {
  const tool = defineActionTool(runtime, 'asc_apply', DESCRIPTION, {
    action: {
      type: 'string',
      enum: ['upload', 'groups', 'metadata-init', 'metadata-apply', 'stage', 'publish'],
      required: true,
      description: 'Which mutation to perform.',
    },
    app: { type: 'string', description: 'App Store Connect app id (falls back to defaultAppId).' },
    file: { type: 'string', description: 'For upload: path to the .ipa or .pkg file.' },
    version: {
      type: 'string',
      description: 'Marketing version, e.g. 1.2.3. Required with pkg (upload/publish); optional with ipa on publish.',
    },
    buildNumber: { type: 'string', description: 'For upload/publish: build number (CFBundleVersion). Required for .pkg.' },
    buildId: {
      type: 'string',
      description: 'For groups/stage: target build id. For groups it replaces app/version/platform (asc rejects combining them).',
    },
    group: { type: 'string', description: 'For groups: beta group id(s) or exact name(s), comma-separated.' },
    submit: {
      type: 'boolean',
      description: 'For groups/publish: submit for beta or App Review after attaching (not with dryRun on groups).',
    },
    wait: { type: 'boolean', description: 'For upload/publish: wait for processing (not with dryRun).' },
    dryRun: { type: 'boolean', description: 'Preview without mutating where supported (upload, groups, metadata-apply, stage, publish).' },
    dir: { type: 'string', description: 'For metadata-init/metadata-apply: metadata directory.' },
    locale: { type: 'string', description: 'For metadata-init: locale to scaffold (default en-US).' },
    force: { type: 'boolean', description: 'For metadata-init: overwrite existing template files.' },
    metadataDir: {
      type: 'string',
      description: 'For stage/publish: metadata directory to apply. stage needs exactly one of metadataDir / copyMetadataFrom.',
    },
    copyMetadataFrom: {
      type: 'string',
      description: 'For stage: copy localization text from this existing version. Exactly one of metadataDir / copyMetadataFrom.',
    },
    reviewDir: { type: 'string', description: 'For metadata-apply: directory for the review artifact.' },
    platform: {
      type: 'string',
      enum: ['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'],
      description: 'Platform filter.',
    },
    ipa: { type: 'string', description: 'For publish: path to a prebuilt .ipa.' },
    pkg: { type: 'string', description: 'For publish: path to a prebuilt macOS .pkg.' },
    confirm: { type: 'boolean', description: 'Explicit confirmation. Only set after the user agrees.' },
  })
  ctx.effect(() => ctx.tools.register(tool))
}
