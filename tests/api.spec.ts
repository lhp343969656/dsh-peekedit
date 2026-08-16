import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionStore } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as PeekeditApi from '../src/api.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup(config: PeekeditApi.Config = {}, options: { sandbox?: boolean } = {}) {
  // Writable sandbox roots always include the system temp dir, so the
  // sandbox scenario builds its trees OUTSIDE tmpdir to make refusals real.
  const baseDir = options.sandbox ? dirname(tmpdir()) : tmpdir()
  const root = await mkdtemp(join(baseDir, 'dsh-peekedit-api-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  if (!options.sandbox) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
  } else {
    // The sandbox root is a subdirectory: files inside it are writable under
    // workspace-write, siblings are not.
    const sandboxRoot = join(root, 'work')
    await mkdir(sandboxRoot, { recursive: true })
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: sandboxRoot })
    await ctx.plugin(SandboxedFileSystem, { cwd: root })
  }
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(PeekeditApi, { root, ...config })
  const session = ctx.sessions.create(undefined, { meta: { cwd: root } })
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  return { ctx, root, base, session }
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe('file-browser API', () => {
  it('lists the session workspace root and subdirectories', async () => {
    const { base, root, session } = await setup()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'a.ts'), 'x')
    await writeFile(join(root, 'top.txt'), 'y')

    const rootList = await json<{ root: string; path: string; entries: { name: string; type: string }[] }>(
      await fetch(`${base}/api/peekedit/list?session=${encodeURIComponent(session.id)}&path=`),
    )
    expect(rootList.root).toBe(root)
    expect(rootList.path).toBe(root)
    expect(rootList.entries).toContainEqual(expect.objectContaining({ name: 'src', type: 'directory' }))
    expect(rootList.entries).toContainEqual(expect.objectContaining({ name: 'top.txt', type: 'file' }))

    const subList = await json<{ entries: { name: string; type: string }[] }>(
      await fetch(`${base}/api/peekedit/list?session=${encodeURIComponent(session.id)}&path=src`),
    )
    expect(subList.entries).toContainEqual(expect.objectContaining({ name: 'a.ts', type: 'file' }))
  })

  it('follows a different session workspace', async () => {
    const { base, ctx } = await setup()
    const other = await mkdtemp(join(tmpdir(), 'dsh-peekedit-other-'))
    roots.push(other)
    await writeFile(join(other, 'other.txt'), 'z')
    const otherSession = ctx.sessions.create(undefined, { meta: { cwd: other } })
    const listed = await json<{ root: string; entries: { name: string }[] }>(
      await fetch(`${base}/api/peekedit/list?session=${encodeURIComponent(otherSession.id)}&path=`),
    )
    expect(listed.root).toBe(other)
    expect(listed.entries).toContainEqual(expect.objectContaining({ name: 'other.txt', type: 'file' }))
  })

  it('falls back to the configured root without a session', async () => {
    const { base, root } = await setup()
    await writeFile(join(root, 'fallback.txt'), 'f')
    const listed = await json<{ root: string; entries: { name: string }[] }>(
      await fetch(`${base}/api/peekedit/list`),
    )
    expect(listed.root).toBe(root)
    expect(listed.entries).toContainEqual(expect.objectContaining({ name: 'fallback.txt', type: 'file' }))
  })

  it('reads and writes file content', async () => {
    const { base, root, session } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'hello')
    const id = encodeURIComponent(session.id)

    const read = await json<{ content: string }>(
      await fetch(`${base}/api/peekedit/read?session=${id}&path=a.txt`),
    )
    expect(read.content).toBe('hello')

    const written = await json<{ operation: string }>(
      await fetch(`${base}/api/peekedit/write`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: session.id, path: 'a.txt', content: 'world' }),
      }),
    )
    expect(written.operation).toBe('update')
    const reRead = await json<{ content: string }>(
      await fetch(`${base}/api/peekedit/read?session=${id}&path=a.txt`),
    )
    expect(reRead.content).toBe('world')
  })

  it('rejects path escapes with 403', async () => {
    const { base, root, session } = await setup()
    await writeFile(join(root, 'secret.txt'), 's')
    const id = encodeURIComponent(session.id)

    const escaped = await fetch(`${base}/api/peekedit/read?session=${id}&path=..%2Fsecret.txt`)
    expect(escaped.status).toBe(403)
    expect((await json<{ error: { code: string } }>(escaped)).error.code).toBe('PATH_ESCAPE')

    const nested = await fetch(`${base}/api/peekedit/list?session=${id}&path=src%2F..%2F..%2F`)
    expect(nested.status).toBe(403)

    // Absolute paths are treated as relative and contained — no escape.
    const absolute = await fetch(`${base}/api/peekedit/read?session=${id}&path=${encodeURIComponent('/secret.txt')}`)
    expect(absolute.status).toBe(200)
  })

  it('reports missing files, non-files, and binary content', async () => {
    const { base, root, session } = await setup({ maxReadChars: 4 })
    await writeFile(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3, 4]))
    const id = encodeURIComponent(session.id)

    const missing = await fetch(`${base}/api/peekedit/read?session=${id}&path=nope.txt`)
    expect(missing.status).toBe(404)
    expect((await json<{ error: { code: string } }>(missing)).error.code).toBe('FS_NOT_FOUND')

    const directory = await fetch(`${base}/api/peekedit/read?session=${id}&path=`)
    expect(directory.status).toBe(400)

    const binary = await fetch(`${base}/api/peekedit/read?session=${id}&path=bin.dat`)
    expect(binary.status).toBe(415)
    expect((await json<{ error: { code: string } }>(binary)).error.code).toBe('FS_NOT_TEXT')
  })

  it('rejects oversized previews with 413', async () => {
    const { base, root, session } = await setup({ maxReadChars: 4 })
    await writeFile(join(root, 'big.txt'), 'x'.repeat(100))
    const id = encodeURIComponent(session.id)
    const response = await fetch(`${base}/api/peekedit/read?session=${id}&path=big.txt`)
    expect(response.status).toBe(413)
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('FS_TOO_LARGE')
  })

  it('denies cross-origin writes and rejects malformed bodies', async () => {
    const { base, root, session } = await setup()
    await writeFile(join(root, 'a.txt'), 'x')

    const evil = await fetch(`${base}/api/peekedit/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ session: session.id, path: 'a.txt', content: 'hax' }),
    })
    expect(evil.status).toBe(403)
    expect((await json<{ error: { code: string } }>(evil)).error.code).toBe('ORIGIN_DENIED')

    const badBody = await fetch(`${base}/api/peekedit/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(badBody.status).toBe(400)

    const badPath = await fetch(`${base}/api/peekedit/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '', content: 'x' }),
    })
    expect(badPath.status).toBe(400)
  })

  it('serves no API without the api entry mounted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-peekedit-noapi-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    const response = await fetch(`${base}/api/peekedit/list`)
    // No route claimed: the fallback answers 404 (the SPA seat is empty here).
    expect(response.status).toBe(404)
  })
})

describe('sandbox policy on writes', () => {
  it('uses the config root without a session and the session cwd with one', async () => {
    // The sandbox config root is a subdirectory (work); the session cwd is
    // the browse root (the temp root itself).
    const { base, root, session } = await setup({}, { sandbox: true })
    await writeFile(join(root, 'work', 'inside.txt'), 'a')
    await writeFile(join(root, 'outside.txt'), 'b')
    const post = (body: object) => fetch(`${base}/api/peekedit/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    // Without a session the write boundary is the config root (work/):
    // inside it writes, outside is denied.
    const inside = await post({ path: 'work/inside.txt', content: 'a2' })
    expect(inside.status).toBe(200)
    const outside = await post({ path: 'outside.txt', content: 'b2' })
    expect(outside.status).toBe(403)
    expect((await json<{ error: { code: string } }>(outside)).error.code).toBe('FS_SANDBOX_DENIED')

    // With a session the boundary follows the session cwd (the browse root),
    // so sibling files become writable — the "can see but cannot write"
    // mismatch disappears.
    const withSession = await post({ session: session.id, path: 'outside.txt', content: 'b3' })
    expect(withSession.status).toBe(200)
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('b3')

    // Raising the session mode to danger-full-access lifts the boundary.
    setSandboxMode(session, 'danger-full-access')
    const lifted = await post({ session: session.id, path: 'outside.txt', content: 'b4' })
    expect(lifted.status).toBe(200)
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('b4')
  })
})

