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
export type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
export type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import { BUNDLED_SKILLS } from './capabilities.js'
import { JOBS } from './capabilities.js'
import { SUPPORTED_ASC_RANGE, PINNED_ASC_VERSION, compatStatus, compatMessage } from './compat.js'
import { existsSync } from 'node:fs'
import { renderVersionNotice } from './format.js'
import type { AscRuntime } from './runtime.js'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { withVersionNotice } from './tools/common.js'
import type { AscEngine, DiagnoseReport } from './control/engine.js'

function mark(ok: boolean): string {
  return ok ? '✓' : '✗'
}

function versionLabel(report: DiagnoseReport): string {
  if (report.version === undefined) return report.versionNotice?.code === 'engine-missing' ? 'asc not found' : 'asc version unknown'
  const suffix = report.compat === 'supported' ? '' : ` (${report.compat} vs ${SUPPORTED_ASC_RANGE})`
  return `asc ${report.version}${suffix}`
}

function authLabel(report: DiagnoseReport): string {
  if (!report.checks.some((check) => check.name === 'auth')) return 'auth not checked'
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
  lines.push('', 'Low-level: asc · asc_plan · asc_apply · asc_setup · asc.run (escape hatch)')
  lines.push('Write jobs need mode: write, confirm: true and host approval. Read jobs run directly.')
  lines.push(...renderVersionNotice(report.versionNotice))
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
  lines.push(...renderVersionNotice(report.versionNotice))
  const next = nextLines(report)
  if (next.length > 0) lines.push('', ...next)
  return lines.join('\n')
}

/** Register `/asc` and `/asc-doctor` when the host provides commands. */
export function registerCommands(ctx: Context, engine: AscEngine, runtime?: AscRuntime): void {
  ctx.inject(['commands'], (scope) => {
    scope.effect(() =>
      scope.commands.register({
        name: 'asc',
        description: 'App Store Connect: status, capabilities and the next step',
        handler: async (invocation) => {
          try {
            const report = runtime === undefined
              ? await engine.diagnose({ validateAuth: false, checkUpdates: false, signal: invocation.signal })
              : await withVersionNotice(runtime, invocation, async (): Promise<DiagnoseReport> => {
                const cwd = runtime.cwdFor(invocation as unknown as ToolRunContext)
                const snapshot = runtime.versionNotices?.execution(cwd) ?? engine.snapshot(cwd)
                const fact = await engine.inspectVersion(snapshot, { signal: invocation.signal })
                const compat = compatStatus(fact.version)
                return {
                  resolution: snapshot.resolution, compat, authenticated: false,
                  ...(fact.version === undefined ? {} : { version: fact.version }),
                  ...(runtime.config.defaultAppId === undefined ? {} : { defaultAppId: runtime.config.defaultAppId }),
                  checks: [{ name: 'version', ok: compat === 'supported', detail: compatMessage(compat, fact.version) }],
                  provision: { available: runtime.config.allowProvision, pinned: PINNED_ASC_VERSION, cached: existsSync(engine.cachedBinaryPath()) },
                  next: { title: 'Inspect authentication and setup', detail: 'Run /asc-doctor for the full diagnostic report.' },
                }
              })
            return { kind: 'success', text: renderStartCard(report, { skills: BUNDLED_SKILLS.length }) }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        },
      }),
    )
    scope.effect(() =>
      scope.commands.register({
        name: 'asc-doctor',
        description: 'Diagnose asc binary, version, authentication, default app and provisioning',
        handler: async (invocation) => {
          try {
            const report = await engine.diagnose({
              validateAuth: true, checkUpdates: true, signal: invocation.signal,
              ...(runtime === undefined ? {} : { snapshot: engine.snapshot(runtime.cwdFor(invocation as unknown as ToolRunContext)) }),
            })
            return { kind: 'success', text: renderDoctorCard(report) }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        },
      }),
    )
  })
}
