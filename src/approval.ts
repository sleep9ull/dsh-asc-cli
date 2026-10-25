/**
 * Pre-execution policy for every `asc_*` tool.
 *
 * Read-only mode is enforced twice: here (before dispatch) and by `asc`'s own
 * `--read-only` flag (before the HTTP request). Write mode still requires an
 * explicit `confirm` and, by default, a human approval per call.
 *
 * The policy matrix:
 *
 * | kind        | read-only mode                         | write mode            |
 * |-------------|----------------------------------------|-----------------------|
 * | read        | allow                                  | allow                 |
 * | local-write | confirm + approval                     | same                  |
 * | write       | deny                                   | confirm + approval    |
 * | unknown     | ask (or deny, per `unknownCommands`)   | confirm + approval    |
 * | forbidden   | deny                                   | deny                  |
 *
 * `unknown` never means "allow silently": it is either escalated to a human or
 * refused. That closes the gap where a write command the classifier does not
 * recognize could run on the model's own `confirm` argument.
 *
 * A registered action/job also runs its argument validator here first: a
 * combination `asc` would reject is denied (`ASC_INVALID_ARGUMENTS`) before any
 * confirm prompt or human approval, never after.
 */

import type { Context } from '@deepseek-ai/cordis'
import { classifyArgv, kindLabel } from './classify.js'
import type { Config } from './config.js'
import { jobSpecFor, validateJobArgs, type JobArgs } from './jobs.js'
import { specFor, type ActionKind, type ToolArgs } from './registry.js'

/** Structured refusal identity, routable by the host and by retry logic. */
export interface AscErrorInfo {
  readonly name: string
  readonly code: string
}

/** Pre-dispatch decision returned to the tool pipeline. */
export type AscDecision =
  | { kind: 'deny'; reason: string; info: AscErrorInfo }
  | { kind: 'ask'; reason: string; displayReason: { en: string; zh: string } }

/** What the policy knows about one call. */
export interface CallFacts {
  readonly kind: ActionKind
  readonly needsConfirm: boolean
  readonly label: string
  /**
   * Actionable argument problem for a registered action/job, discovered before
   * any confirm or approval prompt. `undefined` when the combination is fine
   * (or when the policy has no validator for this call).
   */
  readonly invalid?: string
}

const INFO = {
  readOnly: { name: 'ASC_READ_ONLY', code: 'ASC_READ_ONLY' },
  confirm: { name: 'ASC_CONFIRM_REQUIRED', code: 'ASC_CONFIRM_REQUIRED' },
  forbidden: { name: 'ASC_FORBIDDEN', code: 'ASC_FORBIDDEN' },
  unknown: { name: 'ASC_UNKNOWN_COMMAND', code: 'ASC_UNKNOWN_COMMAND' },
  invalidArguments: { name: 'ASC_INVALID_ARGUMENTS', code: 'ASC_INVALID_ARGUMENTS' },
} as const satisfies Record<string, AscErrorInfo>

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Inspect one tool call without trusting its argument shape. */
export function inspectCall(name: string, args: unknown, config?: Config): CallFacts | undefined {
  if (name !== 'asc' && !name.startsWith('asc_')) return undefined
  if (name === 'asc') {
    const action = actionOf(args)
    if (action === 'run') {
      const argv = argvOf(args)
      const kind = classifyArgv(argv)
      return {
        kind,
        needsConfirm: kind === 'write' || kind === 'unknown' || kind === 'local-write',
        label: `asc.run: asc ${argv.join(' ')}`,
      }
    }
    if (action === 'discover') {
      return { kind: 'read', needsConfirm: false, label: 'asc.discover' }
    }
  }
  if (name === 'asc_job') {
    const action = actionOf(args)
    const spec = jobSpecFor(action)
    if (spec === undefined) {
      return { kind: 'forbidden', needsConfirm: false, label: action === undefined ? name : `${name}.${action}` }
    }
    const invalid = isRecord(args) ? validateJobArgs(spec.id, args as JobArgs) : undefined
    return {
      kind: spec.risk === 'write' ? 'write' : 'read',
      needsConfirm: spec.needsConfirm,
      label: `asc_job.${spec.id}`,
      ...(invalid === undefined ? {} : { invalid }),
    }
  }
  if (name === 'asc_setup') {
    const action = actionOf(args)
    // Engine-managed actions do not have a command registry entry.
    if (action === 'provision') {
      return { kind: 'local-write', needsConfirm: true, label: 'asc_setup.provision' }
    }
    if (action === 'diagnose') {
      return { kind: 'read', needsConfirm: false, label: 'asc_setup.diagnose' }
    }
  }
  const action = actionOf(args)
  const spec = specFor(name, action)
  if (!spec) {
    return { kind: 'forbidden', needsConfirm: false, label: action ? `${name}.${action}` : name }
  }
  // Validators may consult the config for documented fallbacks (`defaultAppId`);
  // `inspectCall` stays usable without it, so undefined must be tolerated.
  const invalid = spec.validate?.(isRecord(args) ? (args as ToolArgs) : {}, config)
  return {
    kind: spec.kind,
    needsConfirm: spec.needsConfirm === true,
    label: action ? `${name}.${action}` : name,
    ...(invalid === undefined ? {} : { invalid }),
  }
}

/**
 * Match a configured approval exemption. Patterns are literal labels with `*`
 * wildcards (for example `asc_apply.upload` or `asc_apply.*`).
 *
 * Exemptions apply to write/unknown actions in write mode only: they never
 * relax read-only mode, local-write approvals, confirm requirements or the
 * forbidden list.
 */
export function matchesApprovedAction(patterns: readonly string[], label: string): boolean {
  return patterns.some((pattern) => {
    if (pattern.trim().length === 0) return false
    const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`).test(label)
  })
}

function approved(config: Config, facts: CallFacts): boolean {
  return matchesApprovedAction(config.approvedActions, facts.label)
}

function askAbout(facts: CallFacts, reason: string, question: { en: string; zh: string }): AscDecision {
  return {
    kind: 'ask',
    reason: `${facts.label} ${reason}`,
    displayReason: question,
  }
}

/** Decide whether one call may proceed, must ask, or must be denied. */
export function decideCall(config: Config, name: string, args: unknown): AscDecision | undefined {
  const facts = inspectCall(name, args, config)
  if (!facts) return undefined
  const confirmed = confirmOf(args)

  // A combination `asc` would reject must not reach a confirm prompt or a human
  // approval: deny it here with the actionable reason from the same validator
  // the builder uses, before any matrix branch (read-only, confirm, approval).
  if (facts.invalid !== undefined) {
    return { kind: 'deny', info: INFO.invalidArguments, reason: facts.invalid }
  }

  if (facts.kind === 'forbidden') {
    return {
      kind: 'deny',
      info: INFO.forbidden,
      reason: `${facts.label} is not available through this plugin. Authenticate with \`asc auth login\` in a terminal, then retry.`,
    }
  }

  if (facts.kind === 'read') return undefined

  if (facts.kind === 'local-write') {
    if (facts.needsConfirm && !confirmed) {
      return {
        kind: 'deny',
        info: INFO.confirm,
        reason: `${facts.label} writes local files and needs an explicit \`confirm: true\` argument. Explain the intended paths to the user and retry only after they agree.`,
      }
    }
    if (config.requireApproval) {
      return askAbout(facts, 'writes local files', {
        en: `Allow ${facts.label} to write local files?`,
        zh: `允许 ${facts.label} 写入本地文件吗？`,
      })
    }
    return undefined
  }

  if (facts.kind === 'write') {
    if (config.mode === 'read-only') {
      return {
        kind: 'deny',
        info: INFO.readOnly,
        reason: `${facts.label} is a ${kindLabel(facts.kind)} but the plugin is in read-only mode. Ask the user to switch the \`asc-tools\` row to \`mode: write\` before mutating App Store Connect.`,
      }
    }
    if (facts.needsConfirm && !confirmed) {
      return {
        kind: 'deny',
        info: INFO.confirm,
        reason: `${facts.label} mutates state and needs an explicit \`confirm: true\` argument. Explain the intended change to the user and retry with \`confirm: true\` only after they agree.`,
      }
    }
    if (config.requireApproval && !approved(config, facts)) {
      return askAbout(facts, 'mutates App Store Connect', {
        en: `Allow ${facts.label} to modify App Store Connect?`,
        zh: `允许 ${facts.label} 修改 App Store Connect 吗？`,
      })
    }
    return undefined
  }

  // kind === 'unknown': the classifier cannot prove this command is read-only.
  if (config.mode === 'read-only') {
    if (config.unknownCommands === 'deny') {
      return {
        kind: 'deny',
        info: INFO.unknown,
        reason: `${facts.label} cannot be proven read-only and \`unknownCommands\` is set to \`deny\`. Use a known command, or set \`unknownCommands: ask\` to approve it interactively.`,
      }
    }
    return askAbout(facts, 'cannot be proven read-only', {
      en: `Run ${facts.label}? It is not recognized as read-only; App Store Connect writes are still blocked by asc --read-only, but it may write local files.`,
      zh: `执行 ${facts.label} 吗？该命令无法确认为只读；App Store Connect 的写操作仍会被 asc --read-only 拦截，但它可能写入本地文件。`,
    })
  }

  if (facts.needsConfirm && !confirmed) {
    return {
      kind: 'deny',
      info: INFO.confirm,
      reason: `${facts.label} may mutate state and needs an explicit \`confirm: true\` argument. Confirm with the user first.`,
    }
  }
  if (config.requireApproval && !approved(config, facts)) {
    return askAbout(facts, 'may mutate App Store Connect', {
      en: `Allow ${facts.label}? It is not recognized as read-only.`,
      zh: `允许 ${facts.label} 吗？该命令无法确认为只读。`,
    })
  }
  return undefined
}

/** Register the policy listener on the host context. */
export function registerApproval(ctx: Context, config: Config): void {
  ctx.effect(() =>
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = decideCall(config, exec.name, exec.arguments)
      return decision ?? next()
    }),
  )
}
