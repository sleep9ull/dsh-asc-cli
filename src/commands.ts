/**
 * Human-facing slash commands.
 *
 * `/asc` is the product's front door: it prints the current environment state,
 * the capability card and exactly one next step, without involving the model.
 * `/asc-doctor` is the same report with the full validation pass.
 *
 * Command handlers only run read-only engine probes; mutations stay behind
 * tools + approval.
 */

import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILLS } from './capabilities.js'
import { JOBS } from './capabilities.js'
import { SUPPORTED_ASC_RANGE, PINNED_ASC_VERSION } from './compat.js'
import type { AscEngine, DiagnoseReport } from './control/engine.js'

/** Result shape the host renders outside the session history. */
export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

/** What a handler receives. */
export interface CommandInvocation {
  readonly rawInput?: string
  readonly signal?: AbortSignal
  readonly agent?: unknown
}

/** One command definition. */
export interface CommandDefinition {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint?: string }
  handler(invocation: CommandInvocation): Promise<CommandResult> | CommandResult
}

/** Structural view of `@deepseek-ai/dsh-commands`. */
export interface CommandService {
  register(definition: CommandDefinition): () => void
}

function mark(ok: boolean): string {
  return ok ? '✓' : '✗'
}

function versionLabel(report: DiagnoseReport): string {
  if (report.version === undefined) return 'asc not found'
  const suffix = report.compat === 'supported' ? '' : ` (${report.compat} vs ${SUPPORTED_ASC_RANGE})`
  return `asc ${report.version}${suffix}`
}

function authLabel(report: DiagnoseReport): string {
  return report.authenticated ? 'auth ✓' : 'auth missing'
}

function nextLines(report: DiagnoseReport): string[] {
  const next = report.next
  if (next === undefined) return []
  const lines = [`Next: ${next.title}`]
  if (next.command !== undefined) lines.push(`  ${next.command}`)
  if (next.detail !== undefined) lines.push(`  ${next.detail}`)
  return lines
}

/** The `/asc` capability card. */
export function renderStartCard(report: DiagnoseReport, options: { skills: number } = { skills: 0 }): string {
  const app = report.defaultAppId ?? report.firstApp?.id
  const header = [
    'ASC · App Store Connect inside DeepSeek Harness',
    `${versionLabel(report)} · ${authLabel(report)} · app ${app ?? 'not set'} · skills ${options.skills}`,
  ]
  const lines: string[] = [...header, '', 'Jobs:']
  for (const [index, job] of JOBS.entries()) {
    const risk = job.risk === 'write' ? 'write' : 'read'
    lines.push(`  ${String(index + 1).padStart(2)}. ${job.id.padEnd(16)} ${risk.padEnd(5)} ${job.title} — "${job.intent[0]}"`)
  }
  lines.push('', 'Low-level: asc_setup · asc_search · asc_run · asc_apps · asc_builds · asc_testflight · asc_metadata · asc_release')
  lines.push('Write jobs need mode: write, confirm: true and host approval. Read jobs run directly.')
  const next = nextLines(report)
  if (next.length > 0) lines.push('', ...next)
  lines.push('', 'Details: /asc-doctor · Skills: dsh-asc-quickstart (bundled)')
  return lines.join('\n')
}

/** The `/asc-doctor` report. */
export function renderDoctorCard(report: DiagnoseReport): string {
  const lines = ['ASC doctor', '']
  for (const check of report.checks) {
    const icon = check.ok ? mark(true) : check.ok === false && check.name === 'default-app' ? '·' : '✗'
    lines.push(`${icon} ${check.name.padEnd(12)} ${check.detail}`)
  }
  lines.push('')
  lines.push(
    `provision  ${
      report.provision.available
        ? `available (pinned ${report.provision.pinned}${report.provision.cached ? ', cached' : ''})`
        : `disabled (enable allowProvision; pinned ${PINNED_ASC_VERSION})`
    }`,
  )
  if (report.resolution.source === 'cache') lines.push(`binary     using plugin cache at ${report.resolution.path}`)
  const next = nextLines(report)
  if (next.length > 0) lines.push('', ...next)
  return lines.join('\n')
}

/** Register `/asc` and `/asc-doctor` when the host provides commands. */
export function registerCommands(ctx: Context, engine: AscEngine): void {
  ctx.inject(['commands'], (scope) => {
    const service = (scope as unknown as { commands?: CommandService }).commands
    if (service === undefined) return
    scope.effect(() =>
      service.register({
        name: 'asc',
        description: 'App Store Connect: status, capabilities and the next step',
        handler: async () => {
          try {
            const report = await engine.diagnose({ validateAuth: false })
            return { kind: 'success', text: renderStartCard(report, { skills: BUNDLED_SKILLS.length }) }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        },
      }),
    )
    scope.effect(() =>
      service.register({
        name: 'asc-doctor',
        description: 'Diagnose asc binary, version, authentication, default app and provisioning',
        handler: async () => {
          try {
            const report = await engine.diagnose({ validateAuth: true })
            return { kind: 'success', text: renderDoctorCard(report) }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        },
      }),
    )
  })
}
