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
 */

import type { Context } from '@deepseek-ai/cordis'
import { classifyArgv, kindLabel } from './classify.js'
import type { Config } from './config.js'
import { specFor, type ActionKind } from './registry.js'

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
}

const INFO = {
  readOnly: { name: 'ASC_READ_ONLY', code: 'ASC_READ_ONLY' },
  confirm: { name: 'ASC_CONFIRM_REQUIRED', code: 'ASC_CONFIRM_REQUIRED' },
  forbidden: { name: 'ASC_FORBIDDEN', code: 'ASC_FORBIDDEN' },
  unknown: { name: 'ASC_UNKNOWN_COMMAND', code: 'ASC_UNKNOWN_COMMAND' },
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

function askAbout(facts: CallFacts, reason: string, question: { en: string; zh: string }): AscDecision {
  return {
    kind: 'ask',
    reason: `${facts.label} ${reason}`,
    displayReason: question,
  }
}

/** Decide whether one call may proceed, must ask, or must be denied. */
export function decideCall(config: Config, name: string, args: unknown): AscDecision | undefined {
  const facts = inspectCall(name, args)
  if (!facts) return undefined
  const confirmed = confirmOf(args)

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
    if (config.requireApproval) {
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
  if (config.requireApproval) {
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
