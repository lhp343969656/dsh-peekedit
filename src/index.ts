/**
 * dsh-peekedit — enhanced file tools for DeepSeek Harness.
 *
 * Registers three model-facing tools over the Harness filesystem seam:
 * `peek` (windowed view), `peek_edit` (literal replace / insert),
 * `peek_write` (create / overwrite). All reads and mutations flow through
 * `ctx.fs` and the `fs/*` event gate, so sandbox fencing, read-before-edit
 * policy, and remote backends behave exactly as they do for the built-in
 * `read` / `write` / `edit` tools.
 * @module dsh-peekedit
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyPeekEditTool } from './peek-edit.ts'
import { applyPeekTool } from './peek.ts'
import { applyPeekWriteTool } from './peek-write.ts'

export const name = 'dsh-peekedit'
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin configuration, validated against the Schemastery schema. */
export interface Config {
  /** Maximum characters retained for one `peek` view before the clipping notice. */
  maxOutputChars?: number
}

/** Runtime configuration schema for the peekedit tools. */
export const Config: z<Config> = z.object({
  maxOutputChars: z.number().default(16_000),
})

/** Register the three peekedit tools and their prompt guidance. */
export function apply(ctx: Context, config: Config): void {
  const maxOutputChars = config.maxOutputChars ?? 16_000
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    throw new Error('dsh-peekedit: maxOutputChars must be a positive safe integer')
  }

  ctx.systemPrompt.section({
    name: 'tool:peek',
    order: 200,
    text: 'Use the peek tool — not shell commands like cat — to inspect text files and directories. Results include line numbers; use view_range to continue reading large files.',
  })
  ctx.systemPrompt.section({
    name: 'tool:peek_edit',
    order: 201,
    text: 'Use the peek_edit tool for targeted changes to existing UTF-8 text files. str_replace requires the old_str literal to appear exactly once; insert adds lines after a line number.',
  })
  ctx.systemPrompt.section({
    name: 'tool:peek_write',
    order: 202,
    text: 'Use the peek_write tool to create new files or overwrite existing ones with full content.',
  })

  applyPeekTool(ctx, { maxOutputChars })
  applyPeekEditTool(ctx)
  applyPeekWriteTool(ctx)
}
