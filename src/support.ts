/**
 * Shared mechanics for the dsh-peekedit tools: sandbox policy resolution,
 * target resolution, existence checks, and observation recording.
 * @module dsh-peekedit/support
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Clipping notice appended when a view exceeds `maxOutputChars`. */
export const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'

/** Commands that mutate an existing file (dirs are rejected for these). */
export type EditCommand = 'str_replace' | 'insert' | 'overwrite'

/**
 * Per-call sandbox policy resolution and denial mapping. The mounted filesystem
 * may confine mutations by a per-call mode + workspace root; when it does, the
 * sandbox-policy service must be present and resolves the effective policy for
 * the calling agent's session. A bare filesystem (no `sandboxMode`) never
 * confines, so no policy service is needed and every call is unreserved.
 */
export class MutationPolicy {
  private readonly policy: SandboxPolicyService | undefined

  constructor(ctx: Context) {
    this.policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (ctx.fs.sandboxMode !== undefined && this.policy === undefined) {
      throw new Error('dsh-peekedit: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /** Resolve the effective policy for one execution, if the backend confines. */
  resolve(exec: ToolRunContext): SandboxExecutionPolicy | undefined {
    return this.policy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
  }

  /**
   * Map a sandbox denial to the shared `[sandbox: …]` marker the model
   * recognizes from bash; everything else passes through untouched.
   */
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    const mode = (policy as SandboxExecutionPolicy | undefined)?.mode
    return new FsError(sandboxDenialMarker(mode ?? 'read-only'), 'FS_SANDBOX_DENIED', { cause: error })
  }
}

/**
 * Resolve a model-supplied absolute path into a stable target. Relative paths
 * are rejected with the `Maybe you meant …` hint so the model can self-correct.
 */
export async function resolveTarget(
  ctx: Context,
  path: string,
  signal: AbortSignal,
): Promise<FsTarget> {
  if (path.trim().length === 0) throw new Error('path must be a non-empty string')
  if (!isAbsolute(path)) {
    throw new Error(`The path ${path} is not an absolute path, it should start with \`/\`. Maybe you meant /${path}?`)
  }
  return ctx.fs.resolve(path, { signal })
}

/**
 * Stat an existing target. Absence is recorded as a confirmed `fs/observed`
 * absence (so a later `create` can recover a deleted path through the mounted
 * policy) before raising `FS_NOT_FOUND`; directories are rejected for mutation
 * commands. `peek` is the only command that accepts directories.
 */
export async function statExisting(
  ctx: Context,
  target: FsTarget,
  command: 'peek' | EditCommand,
  exec: ToolRunContext,
): Promise<FsInfo> {
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(
      `The path ${target.displayPath} does not exist. Please provide a valid path.`,
      'FS_NOT_FOUND',
    )
  }
  if (info.type === 'directory' && command !== 'peek') {
    throw new FsError(
      `The path ${target.displayPath} is a directory and only the \`peek\` command can be used on directories`,
      'FS_NOT_REGULAR_FILE',
    )
  }
  return info
}

/** Require a parameter that one command needs; reject blank values when asked. */
export function requiredForCommand(
  value: string | undefined,
  parameter: string,
  command: string,
  allowEmpty = true,
): string {
  if (value === undefined) throw new Error(`Parameter \`${parameter}\` is required for command: ${command}`)
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Parameter \`${parameter}\` is empty for command: ${command}`)
  }
  return value
}

/** Record a present observation with the version the tool just observed. */
export function observe(ctx: Context, target: FsTarget, version: FsVersion, exec: ToolRunContext): void {
  ctx.emit('fs/observed', target, { kind: 'present', version }, exec)
}
