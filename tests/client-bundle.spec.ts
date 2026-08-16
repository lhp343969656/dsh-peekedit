import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural tests for the built client bundle (lib/client.js). Run `npm run
 * build` first — these assert the exact format the Web Client module system
 * loads: a classic script registering `window.__ModuleLoader__.load({ id,
 * factory })`, with all value imports resolving through the loader's require.
 */

const clientPath = join(import.meta.dirname, '..', 'lib', 'client.js')

function bundle(): string {
  if (!existsSync(clientPath)) {
    throw new Error('lib/client.js missing — run `npm run build` before these tests')
  }
  return readFileSync(clientPath, 'utf8')
}

describe('client bundle format', () => {
  it('registers through window.__ModuleLoader__.load with the package id', () => {
    const code = bundle()
    expect(code).toContain('window.__ModuleLoader__.load({')
    expect(code).toContain('id: "dsh-peekedit"')
    expect(code).toContain('factory: (require) => {')
    expect(code.trimEnd().endsWith('return module.exports;\n\t}\n});')).toBe(true)
  })

  it('resolves platform words through require, bundling only its own code', () => {
    const code = bundle()
    const required = [...code.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
    expect(required).toEqual(expect.arrayContaining(['react', 'react/jsx-runtime']))
    for (const specifier of required) {
      expect(specifier).toMatch(/^react(-dom)?(\/.*)?$|^@deepseek-ai\//)
    }
  })

  it('materializes name/inject/apply and registers the header action', () => {
    const code = bundle()
    let captured: { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> } | undefined
    const windowStub = {
      __ModuleLoader__: {
        load: (value: typeof captured) => { captured = value },
      },
    }
    // The factory body runs at materialization; react/dom values are only
    // touched at render time, so empty stubs suffice for the import phase.
    const requireStub = () => ({})
    new Function('window', code)(windowStub)
    expect(captured).toBeDefined()
    expect(captured?.id).toBe('dsh-peekedit')

    const exports = captured!.factory(requireStub) as {
      name: string
      inject: string[]
      apply: (ctx: unknown) => void
    }
    expect(exports.name).toBe('dsh-peekedit')
    expect(exports.inject).toEqual(['slots', 'layout'])
    expect(typeof exports.apply).toBe('function')

    // apply() injects into the details column, the shell overlay, and the
    // session header actions slot, registering the panel and its handles.
    const injectedKeys: string[] = []
    const registered: Record<string, unknown>[] = []
    const ctxStub = {
      layout: {
        openDetails: () => {},
        closeDetails: () => {},
      },
      slots: {
        inject: (key: string, factory: () => () => void) => {
          injectedKeys.push(key)
          return factory()
        },
        register: (options: { name: string; id?: string; priority?: number }) => {
          registered.push(options)
          return () => {}
        },
      },
    }
    exports.apply(ctxStub)
    expect(injectedKeys).toEqual([
      'details',
      'shell.overlay',
      'conversation.session.header.actions',
    ])
    expect(registered[0]).toMatchObject({ name: 'details', priority: -1 })
    expect(registered[1]).toMatchObject({ name: 'shell.overlay', id: 'peekedit-details-rail' })
    expect(registered[2]).toMatchObject({ name: 'conversation.session.header.actions', id: 'peekedit-file-browser' })
  })
})
