/**
 * Model-facing `peek_write` tool: create and overwrite over the Harness
 * filesystem seam. `create` refuses existing paths; `overwrite` is
 * version-guarded. Both run through the `fs/write-intent` waterfall.
 * @module dsh-peekedit/peek-write
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MutationPolicy, observe, requiredForCommand, resolveTarget, statExisting } from './support.ts'

/** Create a file, refusing an existing path (guarded `createIfAbsent`). */
async function createFile(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  fileText: string | undefined,
  exec: ToolRunContext,
): Promise<{ path: string; command: 'create'; operation: 'create' | 'update'; before: string | null; after: string }> {
  const content = requiredForCommand(fileText, 'file_text', 'create')
  const sandboxPolicy = policy.resolve(exec)
  const target = await resolveTarget(ctx, path, exec.signal)
  if (await ctx.fs.stat(target, exec.signal) !== undefined) {
    throw new Error(`File already exists at: ${target.displayPath}. Cannot overwrite files using command \`create\`.`)
  }
  const intent = await ctx.waterfall(
    'fs/write-intent',
    target,
    exec,
    () => ({ kind: 'createIfAbsent' } as const),
  )
  let outcome
  try {
    outcome = await ctx.fs.writeText(target, content, intent, exec.signal, sandboxPolicy)
  } catch (error: unknown) {
    throw policy.mapError(error, sandboxPolicy)
  }
  observe(ctx, target, outcome.version, exec)
  return { path: target.displayPath, command: 'create', operation: outcome.operation, before: outcome.before, after: outcome.after }
}

/** Overwrite an existing file, guarded by the version the policy slot or stat observed. */
async function overwriteFile(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  fileText: string | undefined,
  exec: ToolRunContext,
): Promise<{ path: string; command: 'overwrite'; operation: 'create' | 'update'; before: string | null; after: string }> {
  const content = requiredForCommand(fileText, 'file_text', 'overwrite')
  const sandboxPolicy = policy.resolve(exec)
  const target = await resolveTarget(ctx, path, exec.signal)
  const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
  const info = await statExisting(ctx, target, 'overwrite', exec)
  // The policy slot may supply a fresher guard; otherwise stat's version
  // protects the overwrite against a concurrent external change.
  const version = intent !== undefined && intent.kind === 'replaceIfVersion' ? intent.version : info.version
  let outcome
  try {
    outcome = await ctx.fs.writeText(
      target,
      content,
      { kind: 'replaceIfVersion', version },
      exec.signal,
      sandboxPolicy,
    )
  } catch (error: unknown) {
    throw policy.mapError(error, sandboxPolicy)
  }
  observe(ctx, target, outcome.version, exec)
  return { path: target.displayPath, command: 'overwrite', operation: outcome.operation, before: outcome.before, after: outcome.after }
}

function presentPeekWriteCall(args: { command: 'create' | 'overwrite'; path: string; file_text?: string }): ToolCallView {
  const isCreate = args.command === 'create'
  return {
    card: 'diff',
    title: `${args.command} ${args.path}`,
    diffs: [{
      path: args.path,
      // A call-time presenter has no prior file content: a create is always
      // shown as a whole new file.
      oldText: null,
      newText: args.file_text ?? '',
    }],
    locations: [{ path: args.path }],
  }
}

/** Register the model-facing `peek_write` tool. */
export function applyPeekWriteTool(ctx: Context): void {
  const policy = new MutationPolicy(ctx)
  ctx.tools.register(defineTool({
    name: 'peek_write',
    description: 'Write a UTF-8 text file: `create` makes a new file (refusing an existing path); `overwrite` replaces the whole content of an existing file.',
    parameters: {
      command: {
        type: 'string',
        required: true,
        enum: ['create', 'overwrite'],
        description: 'The command to run. Allowed options are: `create`, `overwrite`.',
      },
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the file to write, e.g. `/repo/new.py`.',
      },
      file_text: {
        type: 'string',
        required: true,
        description: 'The full new file content.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          command: { type: 'string', required: true },
          operation: { type: 'string', required: true },
          before: {
            required: true,
            oneOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.operation === 'create'
          ? `New file created successfully at: ${value.path}`
          : `The file ${value.path} has been written successfully.`,
      }],
      presentationMeta: (args, value) => ({
        diffs: value.before === null
          ? []
          : [{ path: args.path, oldText: value.before, newText: value.after }],
      }),
    },
    async execute(args, exec: ToolRunContext) {
      switch (args.command) {
        case 'create':
          return createFile(ctx, policy, args.path, args.file_text, exec)
        case 'overwrite':
          return overwriteFile(ctx, policy, args.path, args.file_text, exec)
      }
    },
    presentCall: presentPeekWriteCall,
  }))
}
