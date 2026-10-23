/**
 * Pre-execution policy for every `asc_*` tool.
 *
 * Read-only mode is enforced twice: here (before dispatch) and by ASC's own
 * `--read-only` flag (before the HTTP request). Write mode still requires an
 * explicit `confirm` and, by default, a human approval per call.
 */

import type { Context } from '@deepseek-ai/cordis'
import { classifyArgv, kindLabel } from './classify.js'
import type { Config } from './config.js'
import { specFor, type ActionKind } from './registry.js'

/** Pre-dispatch decision returned to the tool pipeline. */
export type AscDecision =
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason: string; displayReason: { en: string; zh: string } }

/** What the policy knows about one call. */
export interface CallFacts {
  readonly kind: ActionKind
  readonly needsConfirm: boolean
  readonly label: string
}

function argvOf(args: unknown): string[] {
  if (args === null || typeof args !== 'object') return []
  const raw = (args as Record<string, unknown>).args
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

function actionOf(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const raw = (args as Record<string, unknown>).action
  return typeof raw === 'string' ? raw : undefined
}

function confirmOf(args: unknown): boolean {
  if (args === null || typeof args !== 'object') return false
  return (args as Record<string, unknown>).confirm === true
}

/** Inspect one tool call without trusting its argument shape. */
export function inspectCall(name: string, args: unknown): CallFacts | undefined {
  if (!name.startsWith('asc_')) return undefined
  if (name === 'asc_run') {
    const argv = argvOf(args)
    const kind = classifyArgv(argv)
    return {
      kind,
      needsConfirm: kind === 'write' || kind === 'unknown' || kind === 'local-write',
      label: `asc_run: asc ${argv.join(' ')}`,
    }
  }
  if (name === 'asc_search') {
    return { kind: 'read', needsConfirm: false, label: 'asc_search' }
  }
  const action = actionOf(args)
  const spec = specFor(name, action)
  if (!spec) {
    return { kind: 'forbidden', needsConfirm: false, label: action ? `${name}.${action}` : name }
  }
  return {
    kind: spec.kind,
    needsConfirm: spec.needsConfirm === true,
    label: action ? `${name}.${action}` : name,
  }
}

/** Decide whether one call may proceed, must ask, or must be denied. */
export function decideCall(config: Config, name: string, args: unknown): AscDecision | undefined {
  const facts = inspectCall(name, args)
  if (!facts) return undefined

  if (facts.kind === 'forbidden') {
    return {
      kind: 'deny',
      reason: `${facts.label} is not available through this plugin. Authenticate with \`asc auth login\` in a terminal, then retry.`,
    }
  }

  const isMutation = facts.kind === 'write' || facts.kind === 'unknown'
  if (isMutation && config.mode === 'read-only') {
    return {
      kind: 'deny',
      reason: `${facts.label} is a ${kindLabel(facts.kind)} but the plugin is in read-only mode. Ask the user to switch the \`asc-tools\` row to \`mode: write\` before mutating App Store Connect.`,
    }
  }

  if (facts.needsConfirm && !confirmOf(args)) {
    return {
      kind: 'deny',
      reason: `${facts.label} mutates state and needs an explicit \`confirm: true\` argument. Explain the intended change to the user and retry with \`confirm: true\` only after they agree.`,
    }
  }

  if (facts.kind === 'write' && config.requireApproval) {
    return {
      kind: 'ask',
      reason: `${facts.label} mutates App Store Connect`,
      displayReason: {
        en: `Allow ${facts.label} to modify App Store Connect?`,
        zh: `允许 ${facts.label} 修改 App Store Connect 吗？`,
      },
    }
  }

  if (facts.kind === 'local-write' && facts.needsConfirm && !confirmOf(args)) {
    return {
      kind: 'deny',
      reason: `${facts.label} writes outside the workspace and needs \`confirm: true\`.`,
    }
  }

  return undefined
}

/** Register the policy listener on the host context. */
export function registerApproval(ctx: Context, config: Config): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = decideCall(config, exec.name, exec.arguments)
    return decision ?? next()
  })
}
