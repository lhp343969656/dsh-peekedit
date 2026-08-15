import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as PeekEdit from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
let callNumber = 0

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function agent(ctx: Context, cwd: string): Agent {
  const id = SessionId(`peekedit-owner-${callNumber}`)
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function call(ctx: Context, owner: Agent | undefined, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`peekedit-${++callNumber}`),
    name,
    arguments: args,
    ...owner === undefined ? {} : { agent: owner },
  })
}

async function setup(
  config: PeekEdit.Config = {},
  options: { fsPolicy?: boolean; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-peekedit-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (options.sandboxMode === undefined) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
  } else {
    await ctx.plugin(SandboxPolicy, { mode: options.sandboxMode, workspaceRoot: root })
    await ctx.plugin(SandboxedFileSystem, { cwd: root })
  }
  if (options.fsPolicy === true) await ctx.plugin(FsPolicy)
  const fiber = await ctx.plugin(PeekEdit, config)
  return { ctx, root, fiber, owner: agent(ctx, root) }
}

describe('dsh-peekedit registration', () => {
  it('registers peek, peek_edit, and peek_write with expected schemas', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.tools.schemas().map(item => item.name)).toEqual(['peek', 'peek_edit', 'peek_write'])
    const peek = ctx.tools.get('peek')
    expect(peek?.presentCall?.({ path: '/workspace/a.txt', view_range: [2, 4] })).toMatchObject({
      card: 'generic',
      kind: 'read',
      locations: [{ path: '/workspace/a.txt', line: 2 }],
    })
    expect(ctx.tools.get('peek_edit')?.presentCall?.({
      command: 'str_replace',
      path: '/workspace/a.txt',
      old_str: 'old',
      new_str: 'new',
    })).toMatchObject({
      card: 'diff',
      diffs: [{ path: '/workspace/a.txt', oldText: 'old', newText: 'new' }],
    })
    expect(ctx.tools.get('peek_write')?.presentCall?.({
      command: 'create',
      path: '/workspace/a.txt',
      file_text: 'hello',
    })).toMatchObject({
      card: 'diff',
      diffs: [{ path: '/workspace/a.txt', oldText: null, newText: 'hello' }],
    })
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('applies the configured maxOutputChars cap', async () => {
    const { ctx, root } = await setup({ maxOutputChars: 40 })
    const sample = join(root, 'caps.txt')
    await writeFile(sample, 'a\nb\nc\nd\ne\n')
    const result = await call(ctx, undefined, 'peek', { path: sample })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('<response clipped>')
  })
})

describe('peek', () => {
  it('views a file with line numbers and observes it', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'one\ntwo\nthree')
    const result = await call(ctx, owner, 'peek', { path: sample })
    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain(`Here's the content of ${sample} with line numbers (which has a total of 3 lines)`)
    expect(output).toContain('     1  one')
    expect(output).toContain('     3  three')
  })

  it('honors view_range and rejects invalid ranges', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, '1\n2\n3\n4\n5\n')
    const ranged = await call(ctx, undefined, 'peek', { path: sample, view_range: [2, 4] })
    expect(ranged.isError).toBe(false)
    expect(text(ranged)).toContain('     2  2')
    expect(text(ranged)).toContain('     4  4')
    expect(text(ranged)).not.toContain('1\n')
    const bad = await call(ctx, undefined, 'peek', { path: sample, view_range: [9, 10] })
    expect(bad.isError).toBe(true)
  })

  it('lists directories 2 levels deep, excluding hidden and dependency entries', async () => {
    const { ctx, root } = await setup()
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await writeFile(join(root, 'src', 'nested', 'deep.ts'), 'x')
    await writeFile(join(root, 'src', 'a.ts'), 'x')
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'top.txt'), 'x')
    const result = await call(ctx, undefined, 'peek', { path: root })
    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('top.txt')
    expect(output).toContain('a.ts')
    expect(output).toContain('nested')
    // "two levels deep": root + two directory levels; level-3 children are not listed.
    expect(output).not.toContain('deep.ts')
    // The header itself mentions node_modules, so assert no listing row does.
    expect(output.split('\n').some(line => line.endsWith('node_modules'))).toBe(false)
    expect(output.split('\n').some(line => line.includes('\\.git'))).toBe(false)
  })

  it('reports missing files as FS_NOT_FOUND and rejects relative paths', async () => {
    const { ctx } = await setup()
    const missing = await call(ctx, undefined, 'peek', { path: '/nonexistent/file.txt' })
    expect(missing.isError).toBe(true)
    expect(missing.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
    const relative = await call(ctx, undefined, 'peek', { path: 'relative.txt' })
    expect(relative.isError).toBe(true)
  })
})

describe('peek_edit', () => {
  it('performs a unique str_replace and updates the file', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'before foo after')
    const result = await call(ctx, undefined, 'peek_edit', {
      command: 'str_replace',
      path: sample,
      old_str: 'foo',
      new_str: 'bar',
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('has been edited successfully')
    expect(await readFile(sample, 'utf8')).toBe('before bar after')
  })

  it('rejects ambiguous and missing old_str in the old_str vocabulary', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'foo foo\n')
    const ambiguous = await call(ctx, undefined, 'peek_edit', {
      command: 'str_replace',
      path: sample,
      old_str: 'foo',
      new_str: 'bar',
    })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.error).toMatchObject({ info: { code: 'FS_AMBIGUOUS_EDIT' } })
    expect(text(ambiguous)).toContain('Multiple occurrences of old_str')
    const missing = await call(ctx, undefined, 'peek_edit', {
      command: 'str_replace',
      path: sample,
      old_str: 'nope',
      new_str: 'bar',
    })
    expect(missing.isError).toBe(true)
    expect(missing.error).toMatchObject({ info: { code: 'FS_EDIT_NOT_FOUND' } })
    expect(await readFile(sample, 'utf8')).toBe('foo foo\n')
  })

  it('inserts lines at the requested boundary without a trailing newline', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'a\nb')
    const inserted = await call(ctx, undefined, 'peek_edit', {
      command: 'insert',
      path: sample,
      insert_line: 1,
      new_str: 'c\nd',
    })
    expect(inserted.isError).toBe(false)
    expect(await readFile(sample, 'utf8')).toBe('a\nc\nd\nb')
  })

  it('rejects out-of-range insert lines and edits of directories', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'a\n')
    const badLine = await call(ctx, undefined, 'peek_edit', {
      command: 'insert',
      path: sample,
      insert_line: 7,
      new_str: 'x',
    })
    expect(badLine.isError).toBe(true)
    const dir = await call(ctx, undefined, 'peek_edit', {
      command: 'insert',
      path: root,
      insert_line: 0,
      new_str: 'x',
    })
    expect(dir.isError).toBe(true)
    expect(dir.error).toMatchObject({ info: { code: 'FS_NOT_REGULAR_FILE' } })
  })
})

describe('peek_write', () => {
  it('creates a new file and refuses an existing path', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'new.txt')
    const created = await call(ctx, undefined, 'peek_write', {
      command: 'create',
      path: sample,
      file_text: 'hello',
    })
    expect(created.isError).toBe(false)
    expect(text(created)).toContain('New file created successfully')
    expect(await readFile(sample, 'utf8')).toBe('hello')
    const existing = await call(ctx, undefined, 'peek_write', {
      command: 'create',
      path: sample,
      file_text: 'again',
    })
    expect(existing.isError).toBe(true)
    expect(await readFile(sample, 'utf8')).toBe('hello')
  })

  it('overwrites an existing file with a full replacement', async () => {
    const { ctx, root } = await setup()
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'old content')
    const overwritten = await call(ctx, undefined, 'peek_write', {
      command: 'overwrite',
      path: sample,
      file_text: 'new content',
    })
    expect(overwritten.isError).toBe(false)
    expect(text(overwritten)).toContain('has been written successfully')
    expect(await readFile(sample, 'utf8')).toBe('new content')
  })

  it('rejects overwriting a missing file', async () => {
    const { ctx } = await setup()
    const missing = await call(ctx, undefined, 'peek_write', {
      command: 'overwrite',
      path: '/nonexistent/a.txt',
      file_text: 'x',
    })
    expect(missing.isError).toBe(true)
    expect(missing.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
  })
})

describe('policy and sandbox integration', () => {
  it('enforces read-before-edit under fs-observation-policy', async () => {
    const { ctx, root, owner } = await setup({}, { fsPolicy: true })
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'foo')
    const blind = await call(ctx, owner, 'peek_edit', {
      command: 'str_replace',
      path: sample,
      old_str: 'foo',
      new_str: 'bar',
    })
    expect(blind.isError).toBe(true)
    expect(blind.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    // A peek first observes the file (for this agent session), then the edit is allowed.
    const viewed = await call(ctx, owner, 'peek', { path: sample })
    expect(viewed.isError).toBe(false)
    const edited = await call(ctx, owner, 'peek_edit', {
      command: 'str_replace',
      path: sample,
      old_str: 'foo',
      new_str: 'bar',
    })
    expect(edited.isError).toBe(false)
    expect(await readFile(sample, 'utf8')).toBe('bar')
  })

  it('denies mutations with the [sandbox: …] marker in read-only mode', async () => {
    const { ctx, root } = await setup({}, { sandboxMode: 'read-only' })
    const sample = join(root, 'a.txt')
    await writeFile(sample, 'foo')
    const viewed = await call(ctx, undefined, 'peek', { path: sample })
    expect(viewed.isError).toBe(false)
    const denied = await call(ctx, undefined, 'peek_edit', {
      command: 'str_replace',
      path: sample,
      old_str: 'foo',
      new_str: 'bar',
    })
    expect(denied.isError).toBe(true)
    expect(denied.error).toMatchObject({ info: { code: 'FS_SANDBOX_DENIED' } })
    expect(text(denied)).toContain('[sandbox: file access denied under read-only mode]')
    expect(await readFile(sample, 'utf8')).toBe('foo')
  })
})
