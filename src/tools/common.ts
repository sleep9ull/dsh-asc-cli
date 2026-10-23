/**
 * Small helpers shared by every tool definition.
 */

import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderResult, type AscToolResult } from '../format.js'
import type { ToolArgs } from '../registry.js'
import type { AscRuntime } from '../runtime.js'

/**
 * Canonical output schema shared by every `asc_*` tool.
 *
 * The canonical value is lossless JSON; its documented shape is
 * {@link AscToolResult}. A `json` schema keeps the tool contract stable while
 * upstream commands evolve.
 */
export const RESULT_SCHEMA = { type: 'json' } as const satisfies ValueSchemaSpec

/**
 * Declare one tool that forwards to a registry action.
 * @param runtime - shared execution runtime.
 * @param name - tool name (`asc_*`).
 * @param description - model-facing description.
 * @param parameters - parameter schema.
 */
export function defineActionTool<S extends ParameterSchemaSpec>(
  runtime: AscRuntime,
  name: string,
  description: string,
  parameters: S,
) {
  return defineTool({
    name,
    description,
    parameters,
    timeoutMs: runtime.config.longTimeoutMs + 30_000,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => renderResult(value as unknown as AscToolResult),
    },
    presentCall: (args) => {
      const action = (args as { action?: unknown }).action
      const suffix = typeof action === 'string' ? ` ${action}` : ''
      return { card: 'terminal', title: `${name}${suffix}`, description: 'App Store Connect CLI' }
    },
    presentResult: (_args, result) => {
      const value = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
      return { card: 'terminal', title: name, output: value, exitCode: result.isError ? 1 : 0 }
    },
    async execute(args, exec) {
      const action = (args as { action?: unknown }).action
      const actionName = typeof action === 'string' ? action : undefined
      return (await runtime.runAction(name, actionName, args as ToolArgs, exec)) as unknown as JsonValue
    },
  })
}
