/**
 * dsh-peekedit — enhanced file tools and file browser for DeepSeek Harness.
 *
 * Host plugin: registers three model-facing tools (`peek`, `peek_edit`,
 * `peek_write`) over the `ctx.fs` seam. The file-browser API lives in the
 * separate `dsh-peekedit/api` entry (see `./api.ts`), which activates only
 * where a `webServer` service is mounted.
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
