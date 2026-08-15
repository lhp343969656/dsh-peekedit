/**
 * Model-facing `peek` tool: windowed file view and shallow directory listing
 * over the Harness filesystem seam. Reads record `fs/observed` so the mounted
 * read-before-edit policy recognizes the target.
 * @module dsh-peekedit/peek
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { TRUNCATED_MESSAGE, resolveTarget, statExisting } from './support.ts'

/** Resolved `peek` configuration (plugin config after defaulting). */
export interface PeekCaps {
  /** Maximum characters retained for one view before the clipping notice. */
  maxOutputChars: number
}

/** Validated `peek` arguments after defaulting. */
export interface PeekInput {
  path: string
  viewRange?: [number, number]
}

/** Parse and validate `view_range` into a resolved slice. */
export function parseViewRange(viewRange: number[] | undefined, totalLines: number): { start: number; end: number } | undefined {
  if (viewRange === undefined) return undefined
  const [requestedInitialLine, requestedFinalLine] = viewRange
  if (
    viewRange.length !== 2
    || requestedInitialLine === undefined
    || requestedFinalLine === undefined
    || !viewRange.every(Number.isInteger)
  ) {
    throw new Error('Invalid `view_range`. It should be a list of two integers.')
  }
  const start = requestedInitialLine
  const end = requestedFinalLine
  if (start < 1 || start > totalLines) {
    throw new Error(
      `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its first element \`${start}\` should be within the range of lines of the file: [1, ${totalLines}]`,
    )
  }
  if (end > totalLines) {
    throw new Error(
      `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${end}\` should be smaller than the number of lines in the file: \`${totalLines}\``,
    )
  }
  if (end !== -1 && end < start) {
    throw new Error(
      `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${end}\` should be larger or equal than its first \`${start}\``,
    )
  }
  return end === -1 ? { start, end: totalLines } : { start, end }
}

function maybeTruncate(content: string, maxOutputChars: number): { text: string; truncated: boolean } {
  return content.length <= maxOutputChars
    ? { text: content, truncated: false }
    : { text: content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE, truncated: true }
}

/**
 * Render a file view: header with total line count, then numbered lines
 * (`cat -n` style, one-based), honoring `view_range` and the output cap.
 */
export function formatFileView(
  path: string,
  content: string,
  maxOutputChars: number,
  viewRange?: [number, number],
): { content: string; startLine: number; endLine: number; totalLines: number; truncated: boolean } {
  const allLines = content.split('\n')
  const totalLines = allLines.length
  const range = parseViewRange(viewRange, totalLines)
  const lines = range === undefined
    ? allLines
    : allLines.slice(range.start - 1, range.end)
  const startLine = range === undefined ? 1 : range.start
  const endLine = startLine + lines.length - 1
  const prompt = `Here's the content of ${path} with line numbers (which has a total of ${totalLines} lines)`
  const numbered = lines
    .map((line, index) => `${String(startLine + index).padStart(6, ' ')}  ${line}`)
    .join('\n')
  const rendered = maybeTruncate(`${prompt}:\n${numbered}\n`, maxOutputChars)
  return {
    content: rendered.text,
    startLine,
    endLine,
    totalLines,
    truncated: rendered.truncated,
  }
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Render a shallow (2-level) directory listing, excluding hidden/dependency entries. */
export function formatDirectoryListing(
  path: string,
  entries: { name: string; type: 'file' | 'directory' | 'other'; displayPath: string }[][],
  maxOutputChars: number,
): { content: string; truncated: boolean } {
  const rows = [`d\t${path}`, ...entries.flat().map(entry => entry.displayPath)]
  rows.sort((left, right) => codepointCompare(left.slice(left.indexOf('\t') + 1), right.slice(right.indexOf('\t') + 1)))
  const listing = maybeTruncate(rows.join('\n') + '\n', maxOutputChars)
  return {
    content: `Here're the files and directories up to 2 levels deep in ${path}, excluding hidden items, node_modules, and Python cache directories:\n${listing.text}`,
    truncated: listing.truncated,
  }
}

async function listDirectory(
  ctx: Context,
  target: FsTarget,
  maxOutputChars: number,
  exec: ToolRunContext,
): Promise<{ content: string; truncated: boolean }> {
  const entries: { name: string; type: 'file' | 'directory' | 'other'; displayPath: string }[][] = []
  async function visit(dir: FsTarget, depth: number): Promise<void> {
    const children = await ctx.fs.listDir(dir, exec.signal)
    const level: { name: string; type: 'file' | 'directory' | 'other'; displayPath: string }[] = []
    for (const entry of children.filter(candidate =>
      !candidate.name.startsWith('.')
      && candidate.name !== 'node_modules'
      && candidate.name !== '__pycache__')) {
      const type = entry.type === 'directory' ? 'd' : entry.type === 'file' ? 'f' : '?'
      level.push({ name: entry.name, type: entry.type, displayPath: `${type}\t${entry.target.displayPath}` })
      if (entry.type === 'directory' && depth < 2) {
        await visit(entry.target, depth + 1)
      }
    }
    entries.push(level)
  }
  await visit(target, 1)
  return formatDirectoryListing(target.displayPath, entries, maxOutputChars)
}

async function viewPath(
  ctx: Context,
  path: string,
  viewRange: number[] | undefined,
  maxOutputChars: number,
  exec: ToolRunContext,
): Promise<{
  path: string
  kind: 'file' | 'directory'
  startLine: number | null
  endLine: number | null
  totalLines: number | null
  truncated: boolean
  content: string
}> {
  const target = await resolveTarget(ctx, path, exec.signal)
  const info = await statExisting(ctx, target, 'peek', exec)
  if (info.type === 'directory') {
    if (viewRange !== undefined) {
      throw new Error('The `view_range` parameter is not allowed when `path` points to a directory.')
    }
    const listing = await listDirectory(ctx, target, maxOutputChars, exec)
    return {
      path: target.displayPath,
      kind: 'directory',
      startLine: null,
      endLine: null,
      totalLines: null,
      truncated: listing.truncated,
      content: listing.content,
    }
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot peek "${target.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
  }
  const content = await ctx.fs.readText(target, exec.signal)
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  const view = formatFileView(target.displayPath, content, maxOutputChars, viewRange as [number, number] | undefined)
  return {
    path: target.displayPath,
    kind: 'file',
    startLine: view.startLine,
    endLine: view.endLine,
    totalLines: view.totalLines,
    truncated: view.truncated,
    content: view.content,
  }
}

function presentPeekCall(args: { path: string; view_range?: number[] }): GenericCallView {
  return {
    card: 'generic',
    title: `peek ${args.path}`,
    kind: 'read',
    locations: [{
      path: args.path,
      ...args.view_range?.[0] === undefined ? {} : { line: args.view_range[0] },
    }],
  }
}

/** Register the model-facing `peek` tool. */
export function applyPeekTool(ctx: Context, caps: PeekCaps): void {
  ctx.tools.register(defineTool({
    name: 'peek',
    description: 'View a UTF-8 text file with line numbers or a directory listing. Use `view_range` to read a specific line window instead of the whole file; long output is clipped with a notice.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.',
      },
      view_range: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Optional line window for file views. `[11, 40]` shows lines 11–40 (1-based); `[11, -1]` shows from line 11 to the end. Not allowed for directories.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          startLine: {
            required: true,
            oneOf: [
              { type: 'integer' },
              { type: 'null' },
            ],
          },
          endLine: {
            required: true,
            oneOf: [
              { type: 'integer' },
              { type: 'null' },
            ],
          },
          totalLines: {
            required: true,
            oneOf: [
              { type: 'integer' },
              { type: 'null' },
            ],
          },
          truncated: { type: 'boolean', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    async execute(args, exec) {
      return viewPath(ctx, args.path, args.view_range, caps.maxOutputChars, exec)
    },
    presentCall: presentPeekCall,
  }))
}
