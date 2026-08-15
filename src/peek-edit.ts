/**
 * Model-facing `peek_edit` tool: unique-literal replacement and line insert
 * over the Harness filesystem seam. Mutations run through the `fs/edit-intent`
 * waterfall and are written version-guarded, so a stale edit after an external
 * change fails instead of clobbering it.
 * @module dsh-peekedit/peek-edit
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MutationPolicy, observe, requiredForCommand, resolveTarget, statExisting } from './support.ts'

function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = []
  let offset = 0
  while (true) {
    const match = content.indexOf(search, offset)
    if (match < 0) return offsets
    offsets.push(match)
    offset = match + search.length
  }
}

function lineNumbersAt(content: string, offsets: readonly number[]): number[] {
  let line = 1
  let cursor = 0
  return offsets.map((offset) => {
    while (cursor < offset) {
      if (content[cursor] === '\n') line += 1
      cursor += 1
    }
    return line
  })
}

/**
 * Apply a unique-literal replacement. Zero matches and ambiguous matches are
 * reported in the `old_str` vocabulary (never applied silently); the write is
 * guarded by the version the policy slot or the pre-edit stat observed.
 */
async function replaceInFile(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  oldStr: string | undefined,
  newStr: string | undefined,
  exec: ToolRunContext,
): Promise<{ path: string; command: 'str_replace'; before: string; after: string }> {
  const sandboxPolicy = policy.resolve(exec)
  const target = await resolveTarget(ctx, path, exec.signal)
  const oldValue = requiredForCommand(oldStr, 'old_str', 'str_replace', false)
  const newValue = newStr ?? ''
  const intent = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
  const info = await statExisting(ctx, target, 'str_replace', exec)
  const before = await ctx.fs.readText(target, exec.signal)
  const offsets = matchOffsets(before, oldValue)
  const offset = offsets[0]
  if (offset === undefined) {
    throw new FsError(
      `No replacement was performed, old_str \`${oldValue}\` did not appear verbatim in ${target.displayPath}.`,
      'FS_EDIT_NOT_FOUND',
    )
  }
  if (offsets.length > 1) {
    const lines = lineNumbersAt(before, offsets)
    throw new FsError(
      `No replacement was performed. Multiple occurrences of old_str \`${oldValue}\` in lines [${lines.join(', ')}]. Please ensure it is unique`,
      'FS_AMBIGUOUS_EDIT',
    )
  }
  let outcome
  try {
    outcome = await ctx.fs.writeText(
      target,
      before.slice(0, offset) + newValue + before.slice(offset + oldValue.length),
      intent === undefined
        ? { kind: 'replaceIfVersion', version: info.version }
        : { kind: 'replaceIfVersion', version: intent.version },
      exec.signal,
      sandboxPolicy,
    )
  } catch (error: unknown) {
    throw policy.mapError(error, sandboxPolicy)
  }
  observe(ctx, target, outcome.version, exec)
  return { path: target.displayPath, command: 'str_replace', before, after: outcome.after }
}

/**
 * Insert `newStr` after the zero-based `insert_line` (range `[0, lineCount]`)
 * without an implicit trailing newline. Tabs outside the inserted lines are
 * preserved.
 */
async function insertInFile(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  insertLine: number | undefined,
  newStr: string | undefined,
  exec: ToolRunContext,
): Promise<{ path: string; command: 'insert'; before: string; after: string }> {
  if (insertLine === undefined) throw new Error('Parameter `insert_line` is required for command: insert')
  const value = requiredForCommand(newStr, 'new_str', 'insert')
  const sandboxPolicy = policy.resolve(exec)
  const target = await resolveTarget(ctx, path, exec.signal)
  const intent = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
  const info = await statExisting(ctx, target, 'insert', exec)
  const before = await ctx.fs.readText(target, exec.signal)
  const lines = before.split('\n')
  if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
    throw new Error(
      `Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${lines.length}]`,
    )
  }
  const after = [
    ...lines.slice(0, insertLine),
    ...value.split('\n'),
    ...lines.slice(insertLine),
  ].join('\n')
  let outcome
  try {
    outcome = await ctx.fs.writeText(
      target,
      after,
      intent === undefined
        ? { kind: 'replaceIfVersion', version: info.version }
        : { kind: 'replaceIfVersion', version: intent.version },
      exec.signal,
      sandboxPolicy,
    )
  } catch (error: unknown) {
    throw policy.mapError(error, sandboxPolicy)
  }
  observe(ctx, target, outcome.version, exec)
  return { path: target.displayPath, command: 'insert', before, after: outcome.after }
}

function presentPeekEditCall(args: {
  command: 'str_replace' | 'insert'
  path: string
  insert_line?: number
  new_str?: string
  old_str?: string
}): ToolCallView {
  switch (args.command) {
    case 'str_replace':
      return {
        card: 'diff',
        title: `str_replace ${args.path}`,
        diffs: [{
          path: args.path,
          oldText: args.old_str ?? null,
          newText: args.new_str ?? '',
        }],
        locations: [{ path: args.path }],
      }
    case 'insert':
      return {
        card: 'generic',
        title: `insert ${args.path}`,
        kind: 'edit',
        locations: [{
          path: args.path,
          ...args.insert_line === undefined ? {} : { line: Math.max(1, args.insert_line + 1) },
        }],
      }
  }
}

/** Register the model-facing `peek_edit` tool. */
export function applyPeekEditTool(ctx: Context): void {
  const policy = new MutationPolicy(ctx)
  ctx.tools.register(defineTool({
    name: 'peek_edit',
    description: 'Edit an existing UTF-8 text file: `str_replace` swaps one unique literal match; `insert` adds lines after a line number.',
    parameters: {
      command: {
        type: 'string',
        required: true,
        enum: ['str_replace', 'insert'],
        description: 'The command to run. Allowed options are: `str_replace`, `insert`.',
      },
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path to the file to edit, e.g. `/repo/file.py`.',
      },
      old_str: {
        type: 'string',
        description: 'Required parameter of `str_replace` containing the literal text in `path` to replace. Must appear exactly once.',
      },
      new_str: {
        type: 'string',
        description: 'Required parameter of `insert` containing the text to insert; optional parameter of `str_replace` (empty string deletes the match).',
      },
      insert_line: {
        type: 'integer',
        description: 'Required parameter of `insert`. The `new_str` is inserted AFTER line `insert_line` (zero-based; `0` inserts before the first line).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          command: { type: 'string', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `The file ${value.path} has been edited successfully.`,
      }],
      presentationMeta: (args, value) => ({
        diffs: [{
          path: args.path,
          oldText: value.before,
          newText: value.after,
        }],
      }),
    },
    async execute(args, exec) {
      switch (args.command) {
        case 'str_replace':
          return replaceInFile(ctx, policy, args.path, args.old_str, args.new_str, exec)
        case 'insert':
          return insertInFile(ctx, policy, args.path, args.insert_line, args.new_str, exec)
      }
    },
    presentCall: presentPeekEditCall,
  }))
}
