/**
 * Host-side file-browser API: a second plugin entry (`dsh-peekedit/api`)
 * that activates only when a `webServer` service is mounted (web
 * compositions). Same-origin HTTP routes over the `ctx.fs` seam; paths
 * resolve relative to the calling session's workspace (cwd), falling back to
 * the configured root, with escapes rejected by the `ctx.fs.contains`
 * containment check.
 * @module dsh-peekedit/api
 */

import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-peekedit-api'
export const inject = ['webServer', 'fs']

/** Plugin configuration, validated against the Schemastery schema. */
export interface Config {
  /** Fallback browse root when no session (or a cwd-less session) resolves. */
  root?: string
  /** Maximum characters a preview read returns; larger files report `FS_TOO_LARGE`. */
  maxReadChars?: number
}

/** Runtime configuration schema for the file-browser API. */
export const Config: z<Config> = z.object({
  root: z.string().default(process.cwd()),
  maxReadChars: z.number().default(1_000_000),
})

/** Resolved file-browser caps (plugin config after defaulting). */
interface ApiCaps {
  fallbackRoot: string
  maxReadChars: number
}

/** One API failure with its HTTP status and stable code. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } })
}

/** Map a filesystem or API failure onto its HTTP status; infrastructure errors stay 500. */
function mapFsError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    return sendError(res, error.status, error.code, error.message)
  }
  if (error instanceof FsError) {
    switch (error.code) {
      case 'FS_NOT_FOUND':
        return sendError(res, 404, error.code, error.message)
      case 'FS_NOT_DIRECTORY':
      case 'FS_NOT_REGULAR_FILE':
        return sendError(res, 400, error.code, error.message)
      case 'FS_NOT_TEXT':
        return sendError(res, 415, error.code, error.message)
      case 'FS_SANDBOX_DENIED':
        return sendError(res, 403, error.code, error.message)
      case 'FS_TOO_LARGE':
        return sendError(res, 413, error.code, error.message)
      default:
        return sendError(res, 500, error.code, error.message)
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  sendError(res, 500, 'FS_IO_ERROR', message)
}

/** Bound the request body so a runaway POST cannot exhaust memory. */
function readBody(req: IncomingMessage, limit = 16 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > limit) {
        reject(new ApiError(413, 'BODY_TOO_LARGE', `request body exceeds ${limit} bytes`))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Mutating requests must come from the page we serve: the `Origin` header must
 * be absent (curl / same-origin GET-style tools) or parse to the same loopback
 * host:port the server listens on.
 */
function sameOrigin(req: IncomingMessage, server: WebServer): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  return port === server.port && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
}

/** Resolve the browse root: the calling session's cwd, else the fallback root. */
function browseRoot(ctx: Context, session: string | undefined, caps: ApiCaps): string {
  if (session !== undefined) {
    // Probed, not injected: cwd-less sessions and absent stores fall back.
    const sessions = ctx.get('sessions') as SessionStore | undefined
    const cwd = sessions?.get(SessionId(session))?.header.cwd
    if (cwd !== undefined) return cwd
  }
  return caps.fallbackRoot
}

/**
 * Resolve the per-session sandbox policy for a write, mirroring what the
 * model-facing tools do: the session's mode override (or the deployment
 * default) plus its workspace root. Absent a policy service (no sandbox),
 * writes run unreserved like the bare provider.
 */
function sandboxPolicyFor(ctx: Context, session: string | undefined): SandboxExecutionPolicy | undefined {
  const policy = ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
  if (policy === undefined) return undefined
  if (session === undefined) return policy.resolve()
  const sessions = ctx.get('sessions') as SessionStore | undefined
  const found = sessions?.get(SessionId(session))
  return found === undefined ? policy.resolve() : policy.resolve({ session: found })
}

/**
 * Resolve a UI-supplied relative path inside the root. Absolute inputs and
 * `..` segments are treated as relative-then-contained: nothing may escape.
 */
async function resolveInside(ctx: Context, root: string, rel: string): Promise<FsTarget> {
  const parts = rel.replaceAll('\\', '/').split('/').filter(part => part.length > 0 && part !== '.')
  if (parts.some(part => part === '..')) {
    throw new ApiError(403, 'PATH_ESCAPE', 'path escapes the workspace root')
  }
  const rootTarget = await ctx.fs.resolve(root)
  const target = await ctx.fs.resolve(join(root, ...parts))
  if (!ctx.fs.contains(rootTarget, target)) {
    throw new ApiError(403, 'PATH_ESCAPE', 'path escapes the workspace root')
  }
  return target
}

function toEntry(entry: FsDirEntry): { name: string; type: 'file' | 'directory' | 'other'; size?: number } {
  return { name: entry.name, type: entry.type, ...entry.size === undefined ? {} : { size: entry.size } }
}

/** GET /api/peekedit/list?session=<id>&path=<rel> — one directory's children. */
async function handleList(ctx: Context, caps: ApiCaps, url: URL, res: ServerResponse): Promise<void> {
  const root = browseRoot(ctx, url.searchParams.get('session') ?? undefined, caps)
  const target = await resolveInside(ctx, root, url.searchParams.get('path') ?? '')
  const info = await ctx.fs.stat(target)
  if (info === undefined) {
    throw new FsError(`The path ${target.displayPath} does not exist.`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'directory') {
    throw new FsError(`The path ${target.displayPath} is not a directory.`, 'FS_NOT_DIRECTORY')
  }
  const entries = await ctx.fs.listDir(target)
  sendJson(res, 200, { root, path: target.displayPath, entries: entries.map(toEntry) })
}

/** GET /api/peekedit/read?session=<id>&path=<rel> — a UTF-8 file preview. */
async function handleRead(ctx: Context, caps: ApiCaps, url: URL, res: ServerResponse): Promise<void> {
  const root = browseRoot(ctx, url.searchParams.get('session') ?? undefined, caps)
  const target = await resolveInside(ctx, root, url.searchParams.get('path') ?? '')
  const info = await ctx.fs.stat(target)
  if (info === undefined) {
    throw new FsError(`The path ${target.displayPath} does not exist.`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`The path ${target.displayPath} is not a regular file.`, 'FS_NOT_REGULAR_FILE')
  }
  // Byte-approximate cap before reading so huge files fail fast; UTF-8 text
  // reads at most maxReadChars characters anyway.
  if (info.size !== undefined && info.size > caps.maxReadChars * 4) {
    throw new FsError(
      `The file ${target.displayPath} is too large to preview. Use the peek tool for windowed reads.`,
      'FS_TOO_LARGE',
    )
  }
  const content = await ctx.fs.readText(target)
  sendJson(res, 200, { root, path: target.displayPath, content })
}

interface WriteBody {
  session?: string
  path?: string
  content?: string
}

/** POST /api/peekedit/write — replace a file's whole content. */
async function handleWrite(ctx: Context, caps: ApiCaps, server: WebServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!sameOrigin(req, server)) {
    throw new ApiError(403, 'ORIGIN_DENIED', 'cross-origin writes are not allowed')
  }
  let body: WriteBody
  try {
    body = JSON.parse(await readBody(req)) as WriteBody
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'BAD_BODY', 'request body must be JSON: { session?, path, content }')
  }
  if (typeof body.path !== 'string' || body.path.length === 0) {
    throw new ApiError(400, 'BAD_PATH', 'path must be a non-empty string')
  }
  if (typeof body.content !== 'string') {
    throw new ApiError(400, 'BAD_CONTENT', 'content must be a string')
  }
  const root = browseRoot(ctx, body.session, caps)
  const target = await resolveInside(ctx, root, body.path)
  const info = await ctx.fs.stat(target)
  if (info !== undefined && info.type !== 'file') {
    throw new FsError(`The path ${target.displayPath} is not a regular file.`, 'FS_NOT_REGULAR_FILE')
  }
  const policy = sandboxPolicyFor(ctx, body.session)
  console.log(`[peekedit-write] session=${String(body.session)} root=${root} policy=${policy === undefined ? 'none' : JSON.stringify(policy)} path=${body.path}`)
  const outcome = await ctx.fs.writeText(
    target,
    body.content,
    undefined,
    undefined,
    policy,
  )
  sendJson(res, 200, { path: target.displayPath, operation: outcome.operation })
}

/** Register the file-browser routes on the injected web server. */
export function apply(ctx: Context, config: Config): void {
  const caps: ApiCaps = {
    fallbackRoot: config.root ?? process.cwd(),
    maxReadChars: config.maxReadChars ?? 1_000_000,
  }
  if (!Number.isSafeInteger(caps.maxReadChars) || caps.maxReadChars <= 0) {
    throw new Error('dsh-peekedit-api: maxReadChars must be a positive safe integer')
  }
  const server = ctx.webServer
  ctx.effect(() => {
    const disposers = [
      server.register({
        kind: 'exact',
        path: '/api/peekedit/list',
        handler: (req, res) => handleList(ctx, caps, new URL(req.url ?? '/', 'http://x'), res).catch(error => mapFsError(res, error)),
      }),
      server.register({
        kind: 'exact',
        path: '/api/peekedit/read',
        handler: (req, res) => handleRead(ctx, caps, new URL(req.url ?? '/', 'http://x'), res).catch(error => mapFsError(res, error)),
      }),
      server.register({
        kind: 'exact',
        path: '/api/peekedit/write',
        handler: (req, res) => handleWrite(ctx, caps, server, req, res).catch(error => mapFsError(res, error)),
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-peekedit.api')
}
