/**
 * Product-level jobs.
 *
 * A job is one deterministic, resumable workflow composed from `asc` commands:
 * it returns a plan-shaped result with per-step summaries instead of asking the
 * model to invent an orchestration. Jobs are the preferred surface; the typed
 * tools stay available for targeted operations.
 *
 * Approval is enforced twice: `tools/pre-execute` sees the `asc_job` call (via
 * `jobSpecFor`), and `runJob` re-checks the mode/confirm gate so the runner is
 * safe even when called directly.
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { CapabilityJob } from './capabilities.js'
import { jobCapability, JOBS } from './capabilities.js'
import type { Config } from './config.js'
import type { AscEngine } from './control/engine.js'
import type { AscRuntime } from './runtime.js'
import type { AscToolResult } from './format.js'

/** Parameters accepted by `asc_job` (superset of every job's inputs). */
export interface JobArgs {
  readonly app?: string
  readonly version?: string
  readonly platform?: string
  readonly buildId?: string
  readonly file?: string
  readonly buildNumber?: string
  readonly group?: string
  readonly metadataDir?: string
  readonly limit?: number
  readonly dryRun?: boolean
  readonly submit?: boolean
  readonly confirm?: boolean
}

/** What a job may use from the plugin runtime. */
export interface JobContext {
  readonly config: Config
  readonly exec: ToolRunContext
  readonly runtime: Pick<AscRuntime, 'runAction' | 'runArgv'>
  readonly engine: AscEngine
}

/** One executed step, in model-facing form. */
export interface JobStepResult {
  readonly name: string
  readonly ok: boolean
  readonly summary: string
  readonly command?: string
  readonly errorClass?: string
  readonly hint?: string
  readonly durationMs?: number
  readonly data?: JsonValue
}

/** Canonical `asc_job` result. */
export interface JobResult {
  readonly ok: boolean
  readonly job: string
  readonly title: string
  readonly summary: string
  readonly dryRun: boolean
  readonly steps: readonly JobStepResult[]
  readonly data?: JsonValue
  readonly errorClass?: string
  readonly hint?: string
  readonly ascVersion?: string
}

/** One job definition. */
export interface JobSpec extends CapabilityJob {
  run(args: JobArgs, context: JobContext): Promise<JobResult>
}

function asStep(name: string, result: AscToolResult): JobStepResult {
  return {
    name,
    ok: result.ok,
    summary: result.summary,
    command: result.command,
    ...(result.errorClass === undefined ? {} : { errorClass: result.errorClass }),
    ...(result.hint === undefined ? {} : { hint: result.hint }),
    durationMs: result.durationMs,
    ...(result.data === undefined ? {} : { data: result.data }),
  }
}

function stepData(step: JobStepResult): Record<string, unknown> {
  return step.data !== null && typeof step.data === 'object' && !Array.isArray(step.data)
    ? (step.data as Record<string, unknown>)
    : {}
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function appOf(args: JobArgs, config: Config): string {
  const app = args.app ?? config.defaultAppId
  if (app === undefined) {
    throw new Error('asc_job: `app` is required (or set `defaultAppId` in the plugin config)')
  }
  return app
}

/** Build a result, deriving the headline from the last successful step. */
function finish(
  spec: JobSpec,
  steps: JobStepResult[],
  options: {
    summary?: string
    data?: JsonValue
    dryRun: boolean
    errorClass?: string
    hint?: string
    ignoreFailures?: readonly string[]
  },
): JobResult {
  const ignored = new Set(options.ignoreFailures ?? [])
  const failed = steps.find((step) => !step.ok && !ignored.has(step.name))
  const headline =
    options.summary ??
    failed?.summary ??
    steps[steps.length - 1]?.summary ??
    (steps.length === 0 ? spec.title : `${spec.title} completed`)
  return {
    ok: failed === undefined,
    job: spec.id,
    title: spec.title,
    summary: headline,
    dryRun: options.dryRun,
    steps,
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.errorClass === undefined ? {} : { errorClass: options.errorClass }),
    ...(options.hint === undefined ? {} : { hint: options.hint }),
  }
}

const releaseCheck: JobSpec = {
  ...(JOBS.find((job) => job.id === 'release-check') as CapabilityJob),
  async run(args, context) {
    const app = appOf(args, context.config)
    const validate = asStep(
      'validate',
      await context.runtime.runAction(
        'asc_release',
        'validate',
        {
          app,
          ...(args.version === undefined ? {} : { version: args.version }),
          ...(args.platform === undefined ? {} : { platform: args.platform }),
        },
        context.exec,
      ),
    )
    return finish(this, [validate], {
      dryRun: true,
      data: { validate: validate.data ?? null },
      ...(validate.ok ? {} : { errorClass: validate.errorClass, hint: validate.hint }),
    })
  },
}

const shipTestflight: JobSpec = {
  ...(JOBS.find((job) => job.id === 'ship-testflight') as CapabilityJob),
  async run(args, context) {
    if (args.file === undefined) throw new Error('asc_job ship-testflight: `file` is required (path to .ipa or .pkg)')
    const app = appOf(args, context.config)
    const dryRun = args.dryRun === true
    const steps: JobStepResult[] = []

    const upload = asStep(
      'upload',
      await context.runtime.runAction(
        'asc_builds',
        'upload',
        {
          app,
          file: args.file,
          wait: true,
          ...(args.version === undefined ? {} : { version: args.version }),
          ...(args.buildNumber === undefined ? {} : { buildNumber: args.buildNumber }),
          ...(dryRun ? { dryRun: true } : {}),
        },
        context.exec,
      ),
    )
    steps.push(upload)
    const uploaded = stepData(upload)
    const buildId = stringAt(uploaded, 'buildId')

    let groupStep: JobStepResult | undefined
    if (!dryRun && args.group !== undefined && upload.ok) {
      if (buildId === undefined) {
        groupStep = {
          name: 'add-groups',
          ok: false,
          summary: 'upload did not report a buildId; add the build to a group manually once processing finishes',
          errorClass: 'state-conflict',
          hint: 'wait for processing, then use asc_builds with action add-groups and a buildId',
        }
      } else {
        groupStep = asStep(
          'add-groups',
          await context.runtime.runAction(
            'asc_builds',
            'add-groups',
            {
              app,
              group: args.group,
              buildId,
              ...(args.submit === true ? { submit: true } : {}),
              confirm: true,
            },
            context.exec,
          ),
        )
      }
      steps.push(groupStep)
    }

    const summary = dryRun
      ? `dry run: would upload ${args.file}${args.group === undefined ? '' : ` and add it to ${args.group}`}`
      : `uploaded${buildId === undefined ? '' : ` buildId=${buildId}`}${args.group === undefined ? '' : `; group ${args.group}`}`
    const failed = steps.find((step) => !step.ok)
    return finish(this, steps, {
      dryRun,
      summary,
      data: { buildId: buildId ?? null, group: args.group ?? null },
      ...(failed === undefined
        ? {}
        : { errorClass: failed.errorClass ?? 'unknown', ...(failed.hint === undefined ? {} : { hint: failed.hint }) }),
    })
  },
}

const stageRelease: JobSpec = {
  ...(JOBS.find((job) => job.id === 'stage-release') as CapabilityJob),
  async run(args, context) {
    if (args.version === undefined) throw new Error('asc_job stage-release: `version` is required (e.g. 1.2.3)')
    if (args.buildId === undefined) throw new Error('asc_job stage-release: `buildId` is required')
    const app = appOf(args, context.config)
    const dryRun = args.dryRun === true
    const steps: JobStepResult[] = []

    const validate = asStep(
      'validate',
      await context.runtime.runAction(
        'asc_release',
        'validate',
        {
          app,
          version: args.version,
          ...(args.platform === undefined ? {} : { platform: args.platform }),
        },
        context.exec,
      ),
    )
    steps.push(validate)
    if (!validate.ok) {
      return finish(this, steps, { dryRun, errorClass: validate.errorClass, ...(validate.hint === undefined ? {} : { hint: validate.hint }) })
    }

    const stage = asStep(
      'stage',
      await context.runtime.runAction(
        'asc_release',
        'stage',
        {
          app,
          version: args.version,
          buildId: args.buildId,
          ...(args.metadataDir === undefined ? {} : { metadataDir: args.metadataDir }),
          ...(args.platform === undefined ? {} : { platform: args.platform }),
          ...(dryRun ? { dryRun: true } : { confirm: true }),
        },
        context.exec,
      ),
    )
    steps.push(stage)
    return finish(this, steps, {
      dryRun,
      data: { validate: validate.data ?? null, stage: stage.data ?? null },
      ...(stage.ok ? {} : { errorClass: stage.errorClass, ...(stage.hint === undefined ? {} : { hint: stage.hint }) }),
    })
  },
}

const triageFeedback: JobSpec = {
  ...(JOBS.find((job) => job.id === 'triage-feedback') as CapabilityJob),
  async run(args, context) {
    const app = appOf(args, context.config)
    const limit = args.limit ?? 20
    const steps: JobStepResult[] = []

    const feedback = asStep(
      'feedback',
      await context.runtime.runAction(
        'asc_testflight',
        'feedback',
        { app, limit, sort: '-createdDate' },
        context.exec,
      ),
    )
    steps.push(feedback)

    const crashes = asStep(
      'crashes',
      await context.runtime.runAction(
        'asc_testflight',
        'crashes',
        { app, limit, sort: '-createdDate' },
        context.exec,
      ),
    )
    steps.push(crashes)

    let reviews: JobStepResult | undefined
    if (crashes.ok) {
      try {
        const result = await context.runtime.runArgv(
          ['reviews', 'list', '--app', app, '--limit', String(limit)],
          { confirm: false },
          context.exec,
        )
        reviews = asStep('reviews', result)
        steps.push(reviews)
      } catch (error) {
        reviews = {
          name: 'reviews',
          ok: false,
          summary: error instanceof Error ? error.message : String(error),
          errorClass: 'unknown',
        }
        steps.push(reviews)
      }
    }

    const count = (step: JobStepResult | undefined): string => {
      if (step === undefined) return 'n/a'
      const payload = step.data
      if (Array.isArray(payload)) return String(payload.length)
      const collection = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>).data : undefined
      return Array.isArray(collection) ? String(collection.length) : 'n/a'
    }
    return finish(this, steps, {
      dryRun: true,
      ignoreFailures: ['reviews'],
      summary: `feedback=${count(feedback)} crashes=${count(crashes)} reviews=${count(reviews)}`,
      data: {
        feedback: feedback.data ?? null,
        crashes: crashes.data ?? null,
        reviews: reviews?.data ?? null,
      },
      ...(feedback.ok ? {} : { errorClass: feedback.errorClass, ...(feedback.hint === undefined ? {} : { hint: feedback.hint }) }),
    })
  },
}

/** Every job spec, keyed by id. */
export const JOB_SPECS: readonly JobSpec[] = [releaseCheck, shipTestflight, stageRelease, triageFeedback]

const byId = new Map(JOB_SPECS.map((spec) => [spec.id, spec]))

/** Look one job up; unknown ids return `undefined`. */
export function jobSpecFor(id: string | undefined): JobSpec | undefined {
  return id === undefined ? undefined : byId.get(id)
}

/** Every job id, for tool schemas and diagnostics. */
export function jobIds(): string[] {
  return JOB_SPECS.map((spec) => spec.id)
}

/**
 * Run one job after the mode/confirm gate.
 *
 * @throws when the job is unknown, blocked by read-only mode, or unconfirmed.
 */
export async function runJob(id: string, args: JobArgs, context: JobContext): Promise<JobResult> {
  const spec = jobSpecFor(id)
  if (spec === undefined) throw new Error(`asc_job: unknown job "${id}" (expected one of ${jobIds().join(', ')})`)
  if (spec.risk === 'write' && context.config.mode === 'read-only') {
    throw new Error(
      `asc_job ${spec.id} mutates App Store Connect but the plugin is in read-only mode. Ask the user to switch the \`asc-tools\` row to \`mode: write\`.`,
    )
  }
  if (spec.needsConfirm && args.confirm !== true) {
    throw new Error(
      `asc_job ${spec.id} mutates state and needs an explicit \`confirm: true\` after the user agrees. Show the plan first (dryRun: true).`,
    )
  }
  const result = await spec.run(args, context)
  const version = await context.engine.version()
  return version === undefined ? result : { ...result, ascVersion: version }
}
