import { defineConfig } from 'tsdown'

/**
 * The plugin's client bundle is loaded by the Web Client module system as a
 * classic script that self-registers: `window.__ModuleLoader__.load({ id,
 * factory })`. The factory receives the loader's `require`, so every value
 * import outside our own code must stay an external resolved against the
 * platform word table (react, react-dom, @deepseek-ai/… seeds).
 */
const CLIENT_BANNER = `window.__ModuleLoader__.load({
\tid: "dsh-peekedit",
\tfactory: (require) => {
\tvar module = { exports: {} };
\tvar exports = module.exports;
`

const CLIENT_FOOTER = `\treturn module.exports;
\t}
});
`

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/api.ts'],
    outDir: 'lib',
    format: ['esm'],
    fixedExtension: false,
    platform: 'node',
    target: 'es2024',
    clean: true,
    dts: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    fixedExtension: false,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    platform: 'browser',
    target: 'es2020',
    dts: true,
    external: [/^react(-dom)?(\/.*)?$/, /^@deepseek-ai\//],
    banner: CLIENT_BANNER,
    footer: CLIENT_FOOTER,
    clean: false,
  },
])
